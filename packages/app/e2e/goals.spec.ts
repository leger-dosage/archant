import type { Page } from "@playwright/test";

import { daysAgo, euros, expect, test, typed, uniqueName } from "./fixtures.ts";

// Story 21.1: save toward a goal. One database serves the whole run, so each
// test links accounts of its own, which no other goal takes.

const rail = (page: Page) => page.getByRole("navigation", { name: "Navigation principale" });

const breadcrumbs = (page: Page) => page.getByRole("navigation", { name: "Fil d'Ariane" });

const card = (page: Page, name: string) =>
	page.getByRole("list", { name: "Objectifs" }).getByRole("link", { name: new RegExp(name, "u") });

async function openNewGoal(page: Page) {
	await page.goto("/goals");
	await expect(page.getByRole("heading", { level: 1, name: "Objectifs" })).toBeVisible();
	// The header's, or an empty list's own in its place.
	await page.getByRole("button", { name: "Nouvel objectif", exact: true }).first().click();
	const dialog = page.getByRole("dialog", { name: "Nouvel objectif" });
	await expect(dialog).toBeVisible();

	return dialog;
}

test("a goal created from the dialog shows its card, its page and each account's share, then is edited and deleted", async ({
	page,
	api,
}) => {
	const savings = await api.openAccount({
		name: uniqueName("Livret A"),
		kind: "savings",
		openingBalance: "1 000,00",
		openingDate: daysAgo(30),
	});
	const other = await api.openAccount({
		name: uniqueName("LDDS"),
		kind: "savings",
		openingBalance: "500,00",
		openingDate: daysAgo(30),
	});
	const name = uniqueName("Vacances");

	const dialog = await openNewGoal(page);
	await dialog.getByLabel("Nom").fill(name);
	await dialog.getByLabel("Montant visé").fill("2 000");
	// Sixty days ahead: the 800 left asks for 400 a month.
	await dialog.getByLabel("Échéance (facultative)").fill(typed(daysAgo(-60)));
	await dialog.getByRole("checkbox", { name: savings.name }).check();
	await dialog.getByRole("checkbox", { name: other.name }).check();
	await dialog.getByLabel(`Montant affecté depuis ${other.name}`).fill("200");
	await dialog.getByRole("radio", { name: "Avion" }).check({ force: true });
	await dialog.getByRole("button", { name: "Créer l'objectif" }).click();

	await expect(dialog).toBeHidden();
	await expect(page.getByText(`Objectif « ${name} » créé.`)).toBeVisible();
	const goalCard = card(page, name);
	await expect(goalCard).toContainText(`${euros(120_000)} sur ${euros(200_000)}`);
	await expect(goalCard).toContainText("En retard");
	await expect(goalCard).toContainText(`${euros(40_000)} par mois`);
	await expect(
		goalCard.getByRole("img", { name: /^60\s%\sde l'objectif atteint$/u }),
	).toBeVisible();
	await expect(rail(page).getByRole("link", { name: "Objectifs", exact: true })).toHaveAttribute(
		"aria-current",
		"page",
	);

	await goalCard.click();
	await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
	await expect(breadcrumbs(page)).toHaveText(`Objectifs/${name}`);
	await expect(rail(page).getByRole("link", { name: "Objectifs", exact: true })).toHaveAttribute(
		"aria-current",
		"page",
	);
	const progress = page.getByRole("region", { name: "Progression" });
	await expect(progress.getByRole("definition")).toContainText([
		euros(120_000),
		euros(200_000),
		euros(80_000),
	]);
	const accounts = page.getByRole("region", { name: "Comptes liés" });
	await expect(accounts.getByRole("listitem").filter({ hasText: savings.name })).toContainText(
		"Solde entier",
	);
	await expect(accounts.getByRole("listitem").filter({ hasText: other.name })).toContainText(
		`${euros(20_000)} affectés sur ${euros(50_000)}`,
	);

	await page.getByRole("button", { name: "Modifier" }).click();
	const edit = page.getByRole("dialog", { name: "Modifier l'objectif" });
	await expect(edit.getByLabel("Nom")).toHaveValue(name);
	await expect(edit.getByLabel(`Montant affecté depuis ${other.name}`)).toHaveValue("200,00");
	await edit.getByLabel("Montant visé").fill("1 200");
	await edit.getByRole("button", { name: "Enregistrer" }).click();
	await expect(edit).toBeHidden();
	await expect(progress).toContainText("Atteint");
	await expect(progress.getByRole("img", { name: /^100\s%/u })).toBeVisible();
	// A reached goal asks for nothing more each month.
	await expect(progress.getByRole("term")).not.toContainText(["Par mois"]);
	const goalUrl = page.url();

	await page.getByRole("button", { name: "Supprimer" }).click();
	const confirm = page.getByRole("alertdialog");
	await expect(confirm).toContainText(`Supprimer l'objectif « ${name} » ?`);
	await confirm.getByRole("button", { name: "Supprimer" }).click();
	await expect(page).toHaveURL("/goals");
	await expect(page.getByText(`Objectif « ${name} » supprimé.`)).toBeVisible();
	await expect(card(page, name)).toHaveCount(0);

	await page.goto(goalUrl);
	await expect(page.getByRole("heading", { name: "Objectif introuvable" })).toBeVisible();
	await page.getByRole("link", { name: "Retour aux objectifs" }).click();
	await expect(page).toHaveURL("/goals");
});

test("the dialog asks for an account, and refuses one another goal takes whole", async ({
	page,
	api,
}) => {
	const savings = await api.openAccount({ name: uniqueName("Livret A"), kind: "savings" });
	await api.createGoal({ targetAmount: "5 000", accounts: [{ accountId: savings.id }] });
	const name = uniqueName("Travaux");

	const dialog = await openNewGoal(page);
	await dialog.getByLabel("Nom").fill(name);
	await dialog.getByLabel("Montant visé").fill("0");
	await dialog.getByRole("button", { name: "Créer l'objectif" }).click();
	await expect(dialog.getByText("Choisissez au moins un compte.")).toBeVisible();
	await expect(dialog.getByText("Le montant doit être supérieur à zéro.")).toBeVisible();

	await dialog.getByLabel("Montant visé").fill("3 000");
	await dialog.getByRole("checkbox", { name: savings.name }).check();
	await dialog.getByRole("button", { name: "Créer l'objectif" }).click();
	const amount = dialog.getByLabel(`Montant affecté depuis ${savings.name}`);
	await expect(
		dialog.getByText(
			"Un autre objectif prend déjà tout le solde de ce compte. Indiquez un montant.",
		),
	).toBeVisible();
	await expect(amount).toHaveAttribute("aria-invalid", "true");

	await amount.fill("100");
	await dialog.getByRole("button", { name: "Créer l'objectif" }).click();
	await expect(dialog).toBeHidden();
	await expect(card(page, name)).toContainText(`${euros(10_000)} sur ${euros(300_000)}`);
	await expect(card(page, name)).toContainText("Sans échéance");
});

test("a goal the linked accounts' 90-day pace covers is on track", async ({ page, api }) => {
	const savings = await api.openAccount({
		name: uniqueName("Livret A"),
		kind: "savings",
		openingBalance: "0,00",
		openingDate: daysAgo(60),
	});
	await api.addTransaction(savings.id, { date: daysAgo(10), label: "Virement", amount: "3000" });
	// 3 000 since the opening, 1 000 a month; the 500 left over 300 days asks for 50.
	const { name } = await api.createGoal({
		name: uniqueName("Voiture"),
		targetAmount: "3 500",
		targetDate: daysAgo(-300),
		accounts: [{ accountId: savings.id }],
	});

	await page.goto("/goals");
	const goalCard = card(page, name);
	await expect(goalCard).toContainText("En bonne voie");
	await expect(goalCard).toContainText(`${euros(5_000)} par mois`);

	await goalCard.click();
	const progress = page.getByRole("region", { name: "Progression" });
	await expect(progress).toContainText("En bonne voie");
	await expect(progress).toContainText(`${euros(100_000)} par mois`);
});
