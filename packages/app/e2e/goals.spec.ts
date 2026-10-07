import type { Page } from "@playwright/test";

import { z } from "zod";

import { daysAgo, euros, expect, test, typed, uniqueName } from "./fixtures.ts";

// Stories 21.1 to 21.3: save toward a goal, follow it to its end, and keep a
// reserve. One database serves the whole run, so each test links accounts of
// its own, which no other goal takes.

const rail = (page: Page) => page.getByRole("navigation", { name: "Navigation principale" });

const breadcrumbs = (page: Page) => page.getByRole("navigation", { name: "Fil d'Ariane" });

const card = (page: Page, name: string) =>
	page.getByRole("list", { name: "Objectifs" }).getByRole("link", { name: new RegExp(name, "u") });

/** The « … » menu beside a goal's name, opened. */
async function openMenu(page: Page, name: string) {
	await page.getByRole("button", { name: `Actions pour ${name}` }).click();
	const menu = page.getByRole("menu");
	await expect(menu).toBeVisible();

	return menu;
}

/** `12 sept. 2026`, as a sentence names a day. */
const shortDate = (iso: string) =>
	new Intl.DateTimeFormat("fr-FR", {
		day: "numeric",
		month: "short",
		year: "numeric",
		timeZone: "UTC",
	}).format(new Date(`${iso}T00:00:00Z`));

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
	const preview = dialog.getByRole("img", { name: "Aperçu de l'objectif" });
	// No icon picked yet: Sure's avatar shows the name's initial once one is typed.
	await expect(preview.locator("svg")).toHaveCount(1);
	await dialog.getByLabel("Nom").fill(name);
	await expect(preview).toHaveText("V");
	await dialog.getByLabel("Montant visé").fill("2 000");
	// Sixty days ahead: the 800 left asks for 400 a month.
	await dialog.getByLabel("Échéance (facultative)").fill(typed(daysAgo(-60)));
	await dialog.getByRole("checkbox", { name: savings.name }).check();
	await dialog.getByRole("checkbox", { name: other.name }).check();
	await dialog.getByLabel(`Montant affecté depuis ${other.name}`).fill("200");
	await dialog.getByRole("radio", { name: "Avion" }).check({ force: true });
	await expect(preview).toHaveText("");
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

	await (await openMenu(page, name)).getByRole("menuitem", { name: "Supprimer" }).click();
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

test("a goal is paused, completed, archived and restored from its menu and its banners, its chart read as a table", async ({
	page,
	api,
}) => {
	const savings = await api.openAccount({
		name: uniqueName("Livret A"),
		kind: "savings",
		openingBalance: "450,00",
		openingDate: daysAgo(30),
	});
	const { id, name } = await api.createGoal({
		name: uniqueName("Vélo"),
		targetAmount: "1 000",
		targetDate: daysAgo(-60),
		accounts: [{ accountId: savings.id }],
	});

	await page.goto(`/goals/${id}`);
	await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

	// The chart says in words what it draws: the 550 left over 60 days is 275 a month.
	const projection = page.getByRole("region", { name: "Projection" });
	await expect(projection).toContainText(
		`Épargné : ${euros(45_000)}, ${euros(0)} depuis le ${shortDate(daysAgo(30))}. Montant visé : ${euros(100_000)}.`,
	);
	await expect(projection).toContainText(
		`Pour l'atteindre le ${shortDate(daysAgo(-60))}, il faut épargner ${euros(27_500)} par mois.`,
	);
	await projection.getByRole("button", { name: "Voir le tableau" }).click();
	const rows = projection.getByRole("table").getByRole("row");
	// The header, then a row per day since the account opened, newest first.
	await expect(rows).toHaveCount(32);
	await expect(rows.nth(1)).toContainText(euros(45_000));

	await expect((await openMenu(page, name)).getByRole("menuitem")).toHaveText([
		"Mettre en pause",
		"Marquer comme terminé",
		"Archiver",
		"Supprimer",
	]);
	await page.getByRole("menuitem", { name: "Mettre en pause" }).click();
	await expect(page.getByText(`Objectif « ${name} » mis en pause.`)).toBeVisible();
	const paused = page.getByRole("region", { name: "Cet objectif est en pause" });
	await expect(paused).toContainText("Reprenez-le pour continuer à suivre vos progrès.");
	const progress = page.getByRole("region", { name: "Progression" });
	await expect(progress).toContainText("En pause");
	await paused.getByRole("button", { name: "Reprendre l'objectif" }).click();
	await expect(page.getByText(`Objectif « ${name} » repris.`)).toBeVisible();
	await expect(paused).toBeHidden();

	await (
		await openMenu(page, name)
	)
		.getByRole("menuitem", { name: "Marquer comme terminé" })
		.click();
	const complete = page.getByRole("alertdialog", { name: "Marquer cet objectif comme terminé ?" });
	await expect(complete).toContainText(
		new RegExp(`Vous êtes à 45\\s%, ${euros(45_000)} sur ${euros(100_000)}\\.`, "u"),
	);
	await complete.getByRole("button", { name: "Marquer comme terminé" }).click();
	await expect(page.getByText(`Objectif « ${name} » marqué comme terminé.`)).toBeVisible();
	const reached = page.getByRole("region", { name: "Objectif atteint. Bon travail !" });
	await expect(reached).toContainText(`Objectif terminé à ${euros(45_000)} sur ${euros(100_000)}.`);
	await expect(progress).toContainText(`Atteint le ${shortDate(daysAgo(0))} · ${euros(45_000)}`);
	await expect(progress.getByRole("img", { name: /^100\s%/u })).toBeVisible();
	await expect(progress.getByRole("term")).not.toContainText(["Reste"]);
	await expect(progress.getByRole("term")).not.toContainText(["Par mois"]);
	await expect(projection).toHaveCount(0);
	await expect((await openMenu(page, name)).getByRole("menuitem")).toHaveText([
		"Archiver",
		"Rouvrir",
		"Supprimer",
	]);
	await page.getByRole("menuitem", { name: "Rouvrir" }).click();
	await expect(page.getByText(`Objectif « ${name} » rouvert.`)).toBeVisible();
	await expect(reached).toBeHidden();
	await expect(progress).toContainText("En retard");
	await expect(progress).not.toContainText("Atteint le");
	await expect(projection).toBeVisible();

	await (
		await openMenu(page, name)
	)
		.getByRole("menuitem", { name: "Marquer comme terminé" })
		.click();
	await complete.getByRole("button", { name: "Marquer comme terminé" }).click();
	await expect(reached).toBeVisible();

	await reached.getByRole("button", { name: "Archiver l'objectif" }).click();
	const archive = page.getByRole("alertdialog", { name: "Archiver cet objectif ?" });
	await expect(archive).toContainText("Vous pourrez les restaurer plus tard.");
	// Its amount is frozen already: nothing to complete first.
	await expect(archive).not.toContainText("marquez d'abord");
	await archive.getByRole("button", { name: "Archiver" }).click();
	await expect(page.getByText(`Objectif « ${name} » archivé.`)).toBeVisible();
	const archived = page.getByRole("region", { name: "Cet objectif est archivé" });
	await expect(archived).toBeVisible();
	// Archived from completed, it keeps the amount it reached, without « Atteint le », as Sure's.
	await expect(progress.getByRole("definition").first()).toHaveText(euros(45_000));
	await expect(progress).not.toContainText("Atteint le");
	await expect(progress.getByRole("term")).not.toContainText(["Par mois"]);

	await page.goto("/goals");
	await expect(card(page, name)).toHaveCount(0);
	const shelf = page.getByRole("region", { name: "Archivés" });
	await expect(shelf.getByRole("list")).toHaveCount(0);
	await shelf.getByRole("button", { name: /^Afficher/u }).click();
	const archivedCard = shelf
		.getByRole("list", { name: "Archivés" })
		.getByRole("link", { name: new RegExp(name, "u") });
	await expect(archivedCard).toContainText("Archivé");
	await expect(archivedCard).not.toContainText("par mois");
	await archivedCard.click();

	await archived.getByRole("button", { name: "Restaurer l'objectif" }).click();
	await expect(page.getByText(`Objectif « ${name} » restauré.`)).toBeVisible();
	await expect(archived).toBeHidden();
	await expect(progress).not.toContainText("Atteint le");
	await expect(progress).toContainText("En retard");
	await expect(projection).toBeVisible();
});

test("restoring a goal whose account another goal now takes whole is refused, naming the account", async ({
	page,
	api,
}) => {
	const savings = await api.openAccount({ name: uniqueName("Livret A"), kind: "savings" });
	const first = await api.createGoal({
		name: uniqueName("Ancien"),
		targetAmount: "1 000",
		accounts: [{ accountId: savings.id }],
	});
	await api.goalEvent(first.id, "archive");
	await api.createGoal({ targetAmount: "2 000", accounts: [{ accountId: savings.id }] });

	await page.goto(`/goals/${first.id}`);
	const archived = page.getByRole("region", { name: "Cet objectif est archivé" });
	await archived.getByRole("button", { name: "Restaurer l'objectif" }).click();

	await expect(
		page.getByText(
			`Un autre objectif prend désormais tout le solde de « ${savings.name} ». Modifiez l'un des deux pour qu'il y affecte un montant.`,
		),
	).toBeVisible();
	await expect(archived).toBeVisible();
});

test("the dashboard's « Objectifs » card sums the goals holding their money, and lists five", async ({
	page,
	api,
}) => {
	const savings = await api.openAccount({ name: uniqueName("Livret A"), kind: "savings" });
	await api.createGoal({ targetAmount: "1 000", accounts: [{ accountId: savings.id }] });

	await page.goto("/");
	const goals = page.getByRole("region", { name: "Objectifs", exact: true });
	await expect(goals).toBeVisible();

	// Fixed figures, whatever the run's database holds.
	let behind = 1;
	await page.route("**/api/goals/summary", (route) =>
		route.fulfill({
			json: {
				data: {
					currency: "EUR",
					count: 3,
					saved: 50_000,
					target: 150_000,
					behind,
					leftOut: [{ id: "g3", name: "Voyage" }],
					goals: [
						{ id: "g1", name: "Vacances", state: "active", status: "behind", saved: 20_000 },
						{ id: "g2", name: "Vélo", state: "paused", status: "behind", saved: 30_000 },
					].map((goal, index) => ({
						...goal,
						currency: "EUR",
						targetAmount: [100_000, 50_000][index],
						color: "#27a644",
						icon: "piggy-bank",
					})),
				},
			},
		}),
	);
	await page.reload();

	await expect(goals).toContainText(
		`${euros(50_000)}sur ${euros(150_000)} tous objectifs confondus`,
	);
	await expect(goals).toContainText("3 actifs · 1 en retard");
	await expect(goals).toContainText("Hors des totaux, faute de conversion : Voyage.");
	const rows = goals.getByRole("list", { name: "Objectifs en cours" }).getByRole("listitem");
	await expect(rows).toHaveCount(2);
	await expect(rows.nth(0)).toContainText(`VacancesEn retard${euros(20_000)} / ${euros(100_000)}`);
	await expect(rows.nth(1)).toContainText(`VéloEn pause${euros(30_000)} / ${euros(50_000)}`);
	await expect(rows.nth(0).getByRole("link", { name: "Vacances" })).toHaveAttribute(
		"href",
		"/goals/g1",
	);

	behind = 0;
	await page.reload();
	await expect(goals).toContainText("3 actifs · Tout est dans les temps");

	// No goal holding its money: no card.
	let empty = false;
	await page.route("**/api/goals/summary", (route) =>
		empty
			? route.fulfill({
					json: {
						data: {
							currency: "EUR",
							count: 0,
							saved: 0,
							target: 0,
							behind: 0,
							leftOut: [],
							goals: [],
						},
					},
				})
			: route.fallback(),
	);
	empty = true;
	await page.reload();
	await expect(page.getByRole("region", { name: "Bilan" })).toBeVisible();
	await expect(goals).toHaveCount(0);
	empty = false;
	await page.reload();

	await goals.getByRole("link", { name: "Tous les objectifs" }).click();
	await expect(page).toHaveURL("/goals");
});

const suggestedBody = z.object({
	data: z.object({ suggested: z.object({ spending: z.number().nullable() }) }),
});

test("a reserve in months of expenses aims for the budget's suggested spending times its months", async ({
	page,
	api,
	request,
}) => {
	// 45 days back is always in a complete month before this one.
	const checking = await api.openAccount({ openingBalance: "5 000,00", openingDate: daysAgo(60) });
	await api.addTransaction(checking.id, { date: daysAgo(45), label: "Courses", amount: "-300" });
	const savings = await api.openAccount({
		name: uniqueName("Livret A"),
		kind: "savings",
		openingBalance: "0,00",
		openingDate: daysAgo(30),
	});
	const budget = await request.get(`/api/budgets/${daysAgo(0).slice(0, 7)}`);
	const median = suggestedBody.parse(await budget.json()).data.suggested.spending;
	// The server refuses a median of zero.
	expect(median ?? 0).toBeGreaterThan(0);
	const target = 6 * (median ?? 0);
	const name = uniqueName("Urgences");

	const dialog = await openNewGoal(page);
	await dialog.getByLabel("Nom").fill(name);
	await expect(dialog.getByRole("radio", { name: "Objectif ponctuel" })).toBeChecked();
	await dialog.getByRole("radio", { name: "Réserve" }).check();
	// A reserve is kept, never reached by a day.
	await expect(dialog.getByLabel("Échéance (facultative)")).toHaveCount(0);
	await expect(dialog.getByRole("radio", { name: "Un montant fixe" })).toBeChecked();
	await dialog.getByRole("radio", { name: "Un nombre de mois de dépenses" }).check();
	await expect(dialog.getByLabel("Montant visé", { exact: true })).toHaveCount(0);
	await dialog.getByLabel("Mois de dépenses", { exact: true }).fill("6");
	await dialog.getByRole("checkbox", { name: savings.name }).check();
	await dialog.getByRole("button", { name: "Créer l'objectif" }).click();

	await expect(dialog).toBeHidden();
	const reserveCard = card(page, name);
	await expect(reserveCard).toContainText(`${euros(0)} sur ${euros(target)}`);
	await expect(reserveCard).toContainText("Entamée");
	await expect(reserveCard).toContainText("6 mois de dépenses");
	await expect(reserveCard).not.toContainText("par mois");

	await reserveCard.click();
	const progress = page.getByRole("region", { name: "Progression" });
	await expect(progress).toContainText(
		`6 mois de dépenses, à ${euros(median ?? 0)} par mois : la médiane de vos dépenses mensuelles`,
	);
	await expect(progress.getByRole("term")).toContainText([
		"Épargné",
		"Montant visé",
		"À recompléter",
	]);
	await expect(progress.getByRole("term")).not.toContainText(["Échéance"]);

	await page.getByRole("button", { name: "Modifier" }).click();
	const edit = page.getByRole("dialog", { name: "Modifier l'objectif" });
	await expect(edit.getByRole("radio", { name: "Réserve" })).toBeChecked();
	await expect(edit.getByLabel("Mois de dépenses", { exact: true })).toHaveValue("6");

	// Back to a one-off goal: the form sends a fixed target and leaves the months behind.
	await edit.getByRole("radio", { name: "Objectif ponctuel" }).check();
	await edit.getByLabel("Montant visé", { exact: true }).fill("2 500");
	await edit.getByRole("button", { name: "Enregistrer" }).click();
	await expect(edit).toBeHidden();
	await expect(progress.getByRole("definition")).toContainText([euros(0), euros(250_000)]);
	await expect(progress).not.toContainText("mois de dépenses");
	await expect(progress.getByRole("term")).toContainText(["Échéance"]);
	await page.goto("/goals");
	await expect(card(page, name)).toContainText(`${euros(0)} sur ${euros(250_000)}`);
	await expect(card(page, name)).not.toContainText("mois de dépenses");
});

test("a covered reserve is « Constituée », one below its target « Entamée » sorts first, and neither is ever marked as finished", async ({
	page,
	api,
}) => {
	const full = await api.openAccount({
		name: uniqueName("Livret A"),
		kind: "savings",
		openingBalance: "1 000,00",
	});
	const thin = await api.openAccount({
		name: uniqueName("LDDS"),
		kind: "savings",
		openingBalance: "300,00",
	});
	// By name, the funded reserve would come first.
	const funded = await api.createGoal({
		name: uniqueName("Abri"),
		kind: "maintained",
		targetAmount: "800",
		accounts: [{ accountId: full.id }],
	});
	const depleted = await api.createGoal({
		name: uniqueName("Urgences"),
		kind: "maintained",
		targetAmount: "800",
		accounts: [{ accountId: thin.id }],
	});

	await page.goto("/goals");
	await expect(card(page, funded.name)).toContainText(`${euros(100_000)} sur ${euros(80_000)}`);
	await expect(card(page, funded.name)).toContainText("Constituée");
	await expect(card(page, depleted.name)).toContainText("Entamée");
	const names = await page
		.getByRole("list", { name: "Objectifs" })
		.getByRole("heading", { level: 2 })
		.allTextContents();
	expect(names.indexOf(depleted.name)).toBeGreaterThanOrEqual(0);
	expect(names.indexOf(depleted.name)).toBeLessThan(names.indexOf(funded.name));

	await card(page, depleted.name).click();
	const progress = page.getByRole("region", { name: "Progression" });
	await expect(progress).toContainText("Entamée");
	await expect(progress.getByRole("definition")).toContainText([
		euros(30_000),
		euros(80_000),
		euros(50_000),
	]);
	const menu = await openMenu(page, depleted.name);
	await expect(menu.getByRole("menuitem", { name: "Mettre en pause" })).toBeVisible();
	await expect(menu.getByRole("menuitem", { name: "Archiver" })).toBeVisible();
	await expect(menu.getByRole("menuitem", { name: "Marquer comme terminé" })).toHaveCount(0);
});
