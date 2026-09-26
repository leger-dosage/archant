import type { Page } from "@playwright/test";

import { daysAgo, euros, expect, test, uniqueName } from "./fixtures.ts";

// Story 1.6: manage accounts. One database serves the whole run, so group
// totals are asserted as a change around an action, read through the API.

/** The total printed beside a group's heading on the accounts page. */
const pageGroupHeader = (page: Page, group: "Actifs" | "Passifs") =>
	page.getByRole("heading", { level: 2, name: group }).locator("..");

const pageRow = (page: Page, name: string) =>
	page.getByRole("main").getByRole("link", { name: new RegExp(name) });

const sidebarRow = (page: Page, name: string) =>
	page.locator('[data-sidebar="sidebar"]').getByRole("link", { name: new RegExp(name) });

/** Opens the account's « … » menu beside its name. */
async function openMenu(page: Page, name: string) {
	await page.getByRole("button", { name: `Actions du compte ${name}` }).click();
	const menu = page.getByRole("menu");
	await expect(menu).toBeVisible();

	return menu;
}

/** Opens the account's page, then its « Modifier le compte » dialog. */
async function openEdit(page: Page, account: { id: string; name: string }) {
	await page.goto(`/accounts/${account.id}`);
	const menu = await openMenu(page, account.name);
	await menu.getByRole("menuitem", { name: "Modifier" }).click();
	const dialog = page.getByRole("dialog", { name: "Modifier le compte" });
	await expect(dialog).toBeVisible();

	return dialog;
}

/** The account options of the « Filtrer » menu on `/transactions`. */
async function openAccountFilter(page: Page) {
	await page.getByRole("button", { name: "Filtrer" }).click();
	const menu = page.getByRole("dialog");
	await menu.getByRole("button", { name: "Compte", exact: true }).click();

	return menu;
}

test("a new name and subtype show in the header, the sidebar, /accounts and /transactions", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingBalance: "500,00" });
	const label = uniqueName("Renommé");
	await api.addTransaction(account.id, { date: daysAgo(3), label, amount: "-20,00" });
	const name = uniqueName("Livret A");

	const dialog = await openEdit(page, account);
	await dialog.getByLabel("Nom").fill(` ${name} `);
	await dialog.getByRole("combobox", { name: "Type" }).click();
	await page.getByRole("option", { name: "Épargne" }).click();
	await dialog.getByRole("button", { name: "Enregistrer" }).click();
	await expect(page.getByText(`Compte « ${name} » enregistré.`)).toBeVisible();
	await expect(dialog).toBeHidden();
	await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
	await expect(sidebarRow(page, name)).toBeVisible();

	await page.reload();
	const header = page.getByRole("region", { name, exact: true });
	await expect(header).toContainText("Épargne");
	await expect(header).toContainText(euros(48_000));
	await expect(sidebarRow(page, name)).toContainText(euros(48_000));

	await page.goto("/accounts");
	await expect(pageRow(page, name)).toContainText("Épargne");
	await expect(pageRow(page, account.name)).toHaveCount(0);

	await page.goto(`/transactions?q=${encodeURIComponent(label)}`);
	await expect(page.getByRole("main").getByRole("listitem")).toHaveText([
		new RegExp(`${label}.*${name}`, "u"),
	]);
});

test("a credit card offers no type to choose, and a blank name is refused", async ({
	page,
	api,
}) => {
	const card = await api.openAccount({ kind: "credit_card" });

	const dialog = await openEdit(page, card);
	await expect(dialog.getByRole("combobox", { name: "Type" })).toHaveCount(0);
	await dialog.getByLabel("Nom").fill("  ");
	await dialog.getByRole("button", { name: "Enregistrer" }).click();

	await expect(dialog.getByLabel("Nom")).toHaveAccessibleDescription("Ce champ est obligatoire.");
	await expect(dialog).toBeVisible();
	await page.reload();
	await expect(page.getByRole("heading", { level: 1, name: card.name })).toBeVisible();
});

test("Esc or Annuler closes the edit dialog without saving, and it reopens as saved", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ name: uniqueName("Inchangé") });

	const dialog = await openEdit(page, account);
	await dialog.getByLabel("Nom").fill("Brouillon");
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	await expect(
		page.getByRole("button", { name: `Actions du compte ${account.name}` }),
	).toBeFocused();

	await (await openMenu(page, account.name)).getByRole("menuitem", { name: "Modifier" }).click();
	await expect(dialog.getByLabel("Nom")).toHaveValue(account.name);
	await dialog.getByLabel("Nom").fill("  ");
	await dialog.getByRole("button", { name: "Enregistrer" }).click();
	await expect(dialog.getByLabel("Nom")).toHaveAccessibleDescription("Ce champ est obligatoire.");
	await dialog.getByRole("button", { name: "Annuler" }).click();
	await expect(dialog).toBeHidden();

	await (await openMenu(page, account.name)).getByRole("menuitem", { name: "Modifier" }).click();
	await expect(dialog.getByLabel("Nom")).toHaveValue(account.name);
	await expect(dialog.getByLabel("Nom")).not.toHaveAttribute("aria-invalid", "true");
	await page.keyboard.press("Escape");
	await page.reload();
	await expect(page.getByRole("heading", { level: 1, name: account.name })).toBeVisible();
});

test("the account's menu holds its actions, labelled by its state, and the page has no Paramètres tab", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ name: uniqueName("Menu") });

	// An old link to the removed tab falls back to Opérations.
	await page.goto(`/accounts/${account.id}?tab=settings`);
	await expect(page.getByRole("tab")).toHaveText(["Opérations", "Soldes", "Imports"]);
	await expect(page.getByRole("tab", { name: "Opérations" })).toHaveAttribute(
		"aria-selected",
		"true",
	);

	const menu = await openMenu(page, account.name);
	await expect(menu.getByRole("menuitem")).toHaveText([
		"Modifier",
		"Exclure des rapports",
		"Désactiver",
		"Supprimer le compte",
	]);
	await menu.getByRole("menuitem", { name: "Exclure des rapports" }).click();
	await expect(page.getByText(`Compte « ${account.name} » exclu des rapports.`)).toBeVisible();
	await expect(page.getByRole("dialog")).toHaveCount(0);

	await (await openMenu(page, account.name)).getByRole("menuitem", { name: "Désactiver" }).click();
	await expect(page.getByText(`Compte « ${account.name} » désactivé.`)).toBeVisible();
	await expect(page.getByRole("region", { name: account.name, exact: true })).toContainText(
		"Inactif",
	);

	const toggled = await openMenu(page, account.name);
	await expect(toggled.getByRole("menuitem")).toHaveText([
		"Modifier",
		"Inclure dans les rapports",
		"Réactiver",
		"Supprimer le compte",
	]);
	await toggled.getByRole("menuitem", { name: "Inclure dans les rapports" }).click();
	await expect(
		page.getByText(`Compte « ${account.name} » inclus dans les rapports.`),
	).toBeVisible();
	await expect(
		(await openMenu(page, account.name)).getByRole("menuitem", { name: "Exclure des rapports" }),
	).toBeVisible();
	await page.keyboard.press("Escape");
});

test("a deactivated account leaves /accounts, the sidebar and the filter, and comes back when reactivated", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ name: uniqueName("Ancien"), openingBalance: "100,00" });
	const label = uniqueName("Historique");
	await api.addTransaction(account.id, { date: daysAgo(2), label, amount: "-1,00" });
	const before = await api.groupTotal("asset");

	await page.goto(`/accounts/${account.id}`);
	await (await openMenu(page, account.name)).getByRole("menuitem", { name: "Désactiver" }).click();
	await expect(page.getByText(`Compte « ${account.name} » désactivé.`)).toBeVisible();
	await expect(page.getByRole("region", { name: account.name, exact: true })).toContainText(
		"Inactif",
	);
	await expect(sidebarRow(page, account.name)).toHaveCount(0);

	// Its balance of 99,00 leaves the Actifs total.
	expect(await api.groupTotal("asset")).toBe(before - 9_900);
	await page.getByRole("link", { name: "Comptes", exact: true }).click();
	await expect(pageGroupHeader(page, "Actifs")).toContainText(euros(before - 9_900));
	await expect(pageRow(page, account.name)).toHaveCount(0);

	await page.getByRole("switch", { name: "Afficher les comptes inactifs" }).click();
	await expect(page).toHaveURL(/[?&]showInactive=true/u);
	const row = page.getByRole("region", { name: "Actifs" }).getByRole("link", {
		name: new RegExp(account.name),
	});
	await expect(row).toContainText("Inactif");
	await expect(pageGroupHeader(page, "Actifs")).toContainText(euros(before - 9_900));

	// Its transactions stay listed, but the filter no longer offers it.
	await page.goto(`/transactions?q=${encodeURIComponent(label)}`);
	await expect(page.getByRole("main").getByRole("listitem")).toHaveText([
		new RegExp(`${label}.*${account.name}`, "u"),
	]);
	const menu = await openAccountFilter(page);
	await expect(menu.getByRole("checkbox", { name: account.name })).toHaveCount(0);
	await page.keyboard.press("Escape");

	// A link filtering on it from before still names it in its chip, and the
	// menu still offers it, checked, so it can be unchecked.
	await page.goto(`/transactions?account=${encodeURIComponent(JSON.stringify([account.id]))}`);
	const accountChip = page.getByRole("button", { name: `Retirer le filtre ${account.name}` });
	await expect(accountChip).toBeVisible();
	const filtered = await openAccountFilter(page);
	const option = filtered.getByRole("checkbox", { name: account.name });
	await expect(option).toBeChecked();
	await option.uncheck();
	await expect(option).toBeVisible();
	await filtered.getByRole("button", { name: "Appliquer" }).click();
	await expect(page).not.toHaveURL(/[?&]account=/u);
	await expect(accountChip).toHaveCount(0);

	await page.goto("/accounts?showInactive=true");
	await row.click();
	await (await openMenu(page, account.name)).getByRole("menuitem", { name: "Réactiver" }).click();
	await expect(page.getByText(`Compte « ${account.name} » réactivé.`)).toBeVisible();
	await expect(page.getByRole("region", { name: account.name, exact: true })).not.toContainText(
		"Inactif",
	);
	await expect(sidebarRow(page, account.name)).toBeVisible();

	await page.goto("/accounts");
	await expect(pageRow(page, account.name)).not.toContainText("Inactif");
	await expect(pageGroupHeader(page, "Actifs")).toContainText(euros(before));

	await page.goto("/transactions");
	const reopened = await openAccountFilter(page);
	await expect(reopened.getByRole("checkbox", { name: account.name })).toBeVisible();
});

test("the inactive switch shows only when an inactive account exists", async ({ page }) => {
	// The shared database may hold another test's inactive account; this is
	// what the API's list looks like without one.
	const account = {
		id: "00000000-0000-4000-8000-000000000000",
		name: "Seul actif",
		type: "depository",
		subtype: "checking",
		currency: "EUR",
		balance: 1000,
		active: true,
		excludedFromReports: false,
	};
	await page.route("**/api/accounts", (route) =>
		route.fulfill({
			json: {
				data: {
					reportingCurrency: "EUR",
					groups: [
						{ classification: "asset", accounts: [account], total: 1000, excludedCount: 0 },
						{ classification: "liability", accounts: [], total: 0, excludedCount: 0 },
					],
				},
			},
		}),
	);

	await page.goto("/accounts");

	await expect(pageRow(page, "Seul actif")).toBeVisible();
	await expect(page.getByRole("switch", { name: "Afficher les comptes inactifs" })).toHaveCount(0);
});

test("an excluded account stays listed, muted with the eye-off icon, out of its group total", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ name: uniqueName("Exclu"), openingBalance: "250,00" });
	const before = await api.groupTotal("asset");

	// The edit dialog keeps the switch, as Sure's edit form; the menu is the short way.
	const dialog = await openEdit(page, account);
	await dialog.getByRole("switch", { name: "Exclure des rapports" }).click();
	await dialog.getByRole("button", { name: "Enregistrer" }).click();
	await expect(page.getByText(`Compte « ${account.name} » enregistré.`)).toBeVisible();

	expect(await api.groupTotal("asset")).toBe(before - 25_000);
	await page.goto("/accounts");
	await expect(pageGroupHeader(page, "Actifs")).toContainText(euros(before - 25_000));

	const row = pageRow(page, account.name);
	await expect(row).toContainText(euros(25_000));
	await expect(row).toContainText("Exclu des rapports");
	await expect(row.getByText(euros(25_000))).toHaveClass(/text-muted-foreground/u);
	await expect(sidebarRow(page, account.name)).toContainText("Exclu des rapports");

	await row.getByText("Exclu des rapports").locator("..").hover();
	await expect(page.getByRole("tooltip")).toHaveText("Exclu des rapports");
});

test("deleting an account states its transactions, then removes it and them", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ name: uniqueName("Supprimé") });
	const prefix = uniqueName("Disparue");
	await Array.from({ length: 3 }, (_, index) => index + 1).reduce(async (previous, day) => {
		await previous;
		await api.addTransaction(account.id, {
			date: daysAgo(day),
			label: `${prefix} ${day}`,
			amount: "-5,00",
		});
	}, Promise.resolve());
	await api.recordSnapshot(account.id, { date: daysAgo(10), balance: "900,00" });
	const other = await api.openAccount({ name: uniqueName("Gardé") });
	await api.addTransaction(other.id, { date: daysAgo(1), label: `${prefix} gardée`, amount: "-1" });

	await page.goto(`/accounts/${account.id}`);
	await (
		await openMenu(page, account.name)
	)
		.getByRole("menuitem", { name: "Supprimer le compte" })
		.click();

	const dialog = page.getByRole("alertdialog", {
		name: `Supprimer le compte « ${account.name} » et ses 3 opérations ?`,
	});
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText("soldes saisis");
	await expect(dialog.getByRole("button", { name: "Annuler" })).toBeFocused();

	// Every read of the deleted account from the confirmation on: the page it
	// leaves must not ask for it again once it is gone.
	const reads: string[] = [];
	page.on("request", (request) => {
		const { pathname } = new URL(request.url());

		if (request.method() === "GET" && pathname.startsWith(`/api/accounts/${account.id}`)) {
			reads.push(pathname);
		}
	});
	await dialog.getByRole("button", { name: "Supprimer le compte" }).click();

	await expect(page.getByText(`Compte « ${account.name} » supprimé.`)).toBeVisible();
	await expect(page).toHaveURL(/\/accounts$/u);
	await expect(pageRow(page, other.name)).toBeVisible();
	await expect(pageRow(page, account.name)).toHaveCount(0);
	await expect(sidebarRow(page, account.name)).toHaveCount(0);
	await expect(page.getByRole("heading", { level: 2, name: "Actifs" })).toBeVisible();
	expect(reads).toEqual([]);

	await page.goto(`/transactions?q=${encodeURIComponent(prefix)}`);
	await expect(page.getByRole("main").getByRole("listitem")).toHaveText([
		new RegExp(`${prefix} gardée.*${other.name}`, "u"),
	]);

	await page.goto(`/accounts/${account.id}`);
	await expect(page.getByRole("heading", { level: 1, name: "Compte introuvable" })).toBeVisible();
});

test("deleting an account without transactions asks without a count, and Annuler keeps it", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ name: uniqueName("Vide") });

	await page.goto(`/accounts/${account.id}`);
	await (
		await openMenu(page, account.name)
	)
		.getByRole("menuitem", { name: "Supprimer le compte" })
		.click();
	const dialog = page.getByRole("alertdialog", {
		name: `Supprimer le compte « ${account.name} » ?`,
	});
	await expect(dialog).toBeVisible();
	await dialog.getByRole("button", { name: "Annuler" }).click();

	await expect(dialog).toBeHidden();
	await expect(page.getByRole("heading", { level: 1, name: account.name })).toBeVisible();
});
