import type { Locator, Page, Route } from "@playwright/test";

import { daysAgo, euros, expect, test, uniqueName } from "./fixtures.ts";

// Story 1.6: manage accounts. One database serves the whole run, so group
// totals are asserted as a change around an action, read through the API.

/** The total printed beside a group's heading on the accounts page. */
const pageGroupHeader = (page: Page, group: "Actifs" | "Passifs") =>
	page.getByRole("heading", { level: 2, name: group }).locator("..");

const pageRow = (page: Page, name: string) =>
	page.getByRole("main").getByRole("link", { name: new RegExp(name) });

const columnRow = (page: Page, name: string) =>
	page
		.getByRole("complementary", { name: "Liste des comptes" })
		.getByRole("link", { name: new RegExp(name) });

/** Opens the account's « … » menu beside its name. */
async function openMenu(page: Page, name: string) {
	await page.getByRole("button", { name: `Actions du compte ${name}` }).click();
	const menu = page.getByRole("menu");
	await expect(menu).toBeVisible();

	return menu;
}

/** Each entry's lucide icon, in order, at 14 px. */
async function expectMenuIcons(menu: Locator, icons: readonly string[]) {
	const items = menu.getByRole("menuitem");
	await expect(items).toHaveCount(icons.length);

	await Promise.all(
		icons.map(async (icon, index) => {
			const svg = items.nth(index).locator(`svg.lucide-${icon}`);
			await expect(svg).toBeVisible();
			await expect(svg).toHaveCSS("width", "14px");
		}),
	);
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

test("a new name and subtype show in the header, the accounts column, /accounts and /transactions", async ({
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
	await expect(columnRow(page, name)).toBeVisible();

	await page.reload();
	const header = page.getByRole("region", { name, exact: true });
	await expect(header).toContainText("Épargne");
	await expect(header).toContainText(euros(48_000));
	await expect(columnRow(page, name)).toContainText(euros(48_000));

	await page.goto("/accounts");
	await expect(pageRow(page, name)).toContainText("Épargne");
	await expect(pageRow(page, account.name)).toHaveCount(0);

	await page.goto(`/transactions?q=${encodeURIComponent(label)}`);
	await expect(page.getByRole("main").getByRole("listitem")).toHaveText([
		new RegExp(`${label}.*${name}`, "u"),
	]);
});

// Story 28.1: Sure's `include_blank`, « Aucun » in the dialog, the type's name elsewhere.
test("a checking account switched to « Aucun » reads « Liquidités »", async ({ page, api }) => {
	const account = await api.openAccount({ openingBalance: "500,00" });

	const dialog = await openEdit(page, account);
	await dialog.getByRole("combobox", { name: "Type" }).click();
	await expect(page.getByRole("option")).toHaveText([
		"Aucun",
		"Espèces",
		"Compte courant",
		"Épargne",
		"Certificat de dépôt",
		"Marché monétaire",
	]);
	await page.getByRole("option", { name: "Aucun" }).click();
	await dialog.getByRole("button", { name: "Enregistrer" }).click();
	await expect(dialog).toBeHidden();

	await expect(page.getByRole("region", { name: account.name, exact: true })).toContainText(
		"Liquidités",
	);
	await page.goto("/accounts");
	await expect(pageRow(page, account.name)).toContainText("Liquidités");
});

// Story 28.5: Sure's `include_blank` for an investment, then its subtypes by region.
test("a PEA switched to « Aucun » reads « Investissement »", async ({ page, api }) => {
	const account = await api.openAccount({ kind: "pea", openingBalance: "500,00" });

	const dialog = await openEdit(page, account);
	await dialog.getByRole("combobox", { name: "Type" }).click();
	await expect(page.getByRole("option").first()).toHaveText("Aucun");
	await expect(page.getByRole("group", { name: "Europe" }).getByRole("option")).toHaveText([
		"Assurance-vie",
		"Plan d'Épargne en Actions",
		"Prévoyance privée (Pilier 3a)",
		"Riester-Rente",
	]);
	await page.getByRole("option", { name: "Aucun" }).click();
	await dialog.getByRole("button", { name: "Enregistrer" }).click();
	await expect(dialog).toBeHidden();

	await expect(page.getByRole("region", { name: account.name, exact: true })).toContainText(
		"Investissement",
	);
	await page.goto("/accounts");
	await expect(pageRow(page, account.name)).toContainText("Investissement");
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
	// Within the page: the accounts column has tabs of its own once its list loads.
	await expect(page.getByRole("main").getByRole("tab")).toHaveText([
		"Opérations",
		"Soldes",
		"Imports",
	]);
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
	// Story 12.4: a 14 px icon before each entry.
	await expectMenuIcons(menu, ["pencil", "eye-off", "circle-pause", "trash-2"]);
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
	await expectMenuIcons(toggled, ["pencil", "eye", "circle-play", "trash-2"]);
	await toggled.getByRole("menuitem", { name: "Inclure dans les rapports" }).click();
	await expect(
		page.getByText(`Compte « ${account.name} » inclus dans les rapports.`),
	).toBeVisible();
	await expect(
		(await openMenu(page, account.name)).getByRole("menuitem", { name: "Exclure des rapports" }),
	).toBeVisible();
	await page.keyboard.press("Escape");
});

test("deactivated from its row, an account stays on /accounts muted, leaves the accounts column, /transactions and the filter, and comes back when activated", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ name: uniqueName("Ancien"), openingBalance: "100,00" });
	const label = uniqueName("Historique");
	await api.addTransaction(account.id, { date: daysAgo(2), label, amount: "-1,00" });
	const before = await api.groupTotal("asset");

	await page.goto("/accounts");
	await expect(columnRow(page, account.name)).toBeVisible();
	await (
		await openMenu(page, account.name)
	)
		.getByRole("menuitem", { name: "Désactiver le compte" })
		.click();
	await expect(page.getByText(`Compte « ${account.name} » désactivé.`)).toBeVisible();

	// As Sure's `Account.listable_manual`: still listed, its name and balance muted.
	const row = pageRow(page, account.name);
	await expect(row).toBeVisible();
	await expect(row).toHaveAccessibleName(new RegExp(`${account.name} inactif`, "u"));
	await expect(row.getByText(account.name, { exact: true })).toHaveClass(/text-muted-foreground/u);
	await expect(row.getByText(euros(9_900))).toHaveClass(/text-muted-foreground/u);
	await expect(row).not.toContainText("Inactif");
	await expect(columnRow(page, account.name)).toHaveCount(0);

	// Its balance of 99,00 leaves the Actifs total.
	expect(await api.groupTotal("asset")).toBe(before - 9_900);
	await expect(pageGroupHeader(page, "Actifs")).toContainText(euros(before - 9_900));
	await expect(
		(await openMenu(page, account.name)).getByRole("menuitem", { name: "Activer le compte" }),
	).toBeVisible();
	await page.keyboard.press("Escape");

	// As Sure's `Entry.visible`, its transactions leave /transactions and stay on
	// its own page; the filter no longer offers it.
	await page.goto(`/accounts/${account.id}`);
	await expect(page.getByRole("main").getByText(label)).toBeVisible();
	await page.goto(`/transactions?q=${encodeURIComponent(label)}`);
	await expect(page.getByRole("main").getByRole("listitem")).toHaveCount(0);
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

	await page.goto("/accounts");
	await (
		await openMenu(page, account.name)
	)
		.getByRole("menuitem", { name: "Activer le compte" })
		.click();
	await expect(page.getByText(`Compte « ${account.name} » réactivé.`)).toBeVisible();
	await expect(row).not.toHaveAccessibleName(/inactif/u);
	await expect(row.getByText(account.name, { exact: true })).not.toHaveClass(
		/text-muted-foreground/u,
	);
	await expect(columnRow(page, account.name)).toBeVisible();
	await expect(pageGroupHeader(page, "Actifs")).toContainText(euros(before));

	await page.goto(`/transactions?q=${encodeURIComponent(label)}`);
	await expect(page.getByRole("main").getByRole("listitem")).toHaveText([
		new RegExp(`${label}.*${account.name}`, "u"),
	]);
	const reopened = await openAccountFilter(page);
	await expect(reopened.getByRole("checkbox", { name: account.name })).toBeVisible();
});

test("an inactive account is listed with no switch, an old link to the switch included", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ name: uniqueName("Dormant"), openingBalance: "40,00" });
	await api.deactivateAccount(account.id);

	await page.goto("/accounts?showInactive=true");
	await expect(
		page
			.getByRole("region", { name: "Actifs" })
			.getByRole("link", { name: new RegExp(account.name) }),
	).toBeVisible();
	await page.goto("/accounts");
	const row = page
		.getByRole("region", { name: "Actifs" })
		.getByRole("link", { name: new RegExp(account.name) });
	await expect(row).toBeVisible();
	await expect(row.getByText(euros(4_000))).toHaveClass(/text-muted-foreground/u);
	await expect(page.getByRole("switch")).toHaveCount(0);
	await expect(page.getByText("Afficher les comptes inactifs")).toHaveCount(0);
});

test("an excluded account stays listed, the eye-off icon after its name, out of its group total", async ({
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
	// As Sure's row: the marker right after the name, the balance muted only
	// when the account is inactive.
	await expect(row).toHaveAccessibleName(new RegExp(`^${account.name}\\s*Exclu des rapports`, "u"));
	await expect(row.getByText(euros(25_000))).not.toHaveClass(/text-muted-foreground/u);
	await expect(columnRow(page, account.name)).toContainText("Exclu des rapports");

	await row.getByText("Exclu des rapports").locator("..").hover();
	await expect(page.getByRole("tooltip")).toHaveText("Exclu des rapports");
});

test("a row's menu holds Sure's items in Sure's order, excludes and deletes from the list", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ name: uniqueName("Rangée"), openingBalance: "300,00" });
	const prefix = uniqueName("Ligne");
	await Array.from({ length: 3 }, (_, index) => index + 1).reduce(async (previous, day) => {
		await previous;
		await api.addTransaction(account.id, {
			date: daysAgo(day),
			label: `${prefix} ${day}`,
			amount: "-5,00",
		});
	}, Promise.resolve());

	// No request per row on page load: the edit dialog and the count wait to be chosen.
	const reads: string[] = [];
	page.on("request", (request) => {
		const { pathname } = new URL(request.url());

		if (request.method() === "GET" && pathname.startsWith(`/api/accounts/${account.id}`)) {
			reads.push(pathname);
		}
	});
	await page.goto("/accounts");
	const menu = await openMenu(page, account.name);
	await expect(menu.getByRole("menuitem")).toHaveText([
		"Modifier",
		"Désactiver le compte",
		"Exclure de tous les rapports",
		"Définir par défaut",
		"Supprimer le compte",
	]);
	await expect(menu.getByRole("separator")).toHaveCount(2);
	await expectMenuIcons(menu, ["pencil-line", "toggle-right", "eye-off", "star", "trash-2"]);
	expect(reads).toEqual([]);

	await menu.getByRole("menuitem", { name: "Modifier" }).click();
	const dialog = page.getByRole("dialog", { name: "Modifier le compte" });
	await expect(dialog.getByLabel("Nom")).toHaveValue(account.name);
	await dialog.getByRole("button", { name: "Annuler" }).click();
	await expect(dialog).toBeHidden();

	const before = await api.groupTotal("asset");
	await (
		await openMenu(page, account.name)
	)
		.getByRole("menuitem", { name: "Exclure de tous les rapports" })
		.click();
	await expect(page.getByText(`Compte « ${account.name} » exclu des rapports.`)).toBeVisible();
	const row = pageRow(page, account.name);
	await expect(row).toContainText("Exclu des rapports");
	expect(await api.groupTotal("asset")).toBe(before - 28_500);
	await expect(pageGroupHeader(page, "Actifs")).toContainText(euros(before - 28_500));
	const excluded = await openMenu(page, account.name);
	await expect(excluded.getByRole("menuitem")).toHaveText([
		"Modifier",
		"Désactiver le compte",
		"Inclure dans les rapports",
		"Définir par défaut",
		"Supprimer le compte",
	]);
	await expectMenuIcons(excluded, ["pencil-line", "toggle-right", "eye", "star", "trash-2"]);

	// The confirmation waits for the count, so its title never states a wrong one.
	const held: Route[] = [];
	await page.route(`**/api/accounts/${account.id}/transactions*`, (route) => {
		held.push(route);
	});
	const counting = page.waitForRequest((request) =>
		request.url().includes(`/api/accounts/${account.id}/transactions`),
	);
	await excluded.getByRole("menuitem", { name: "Supprimer le compte" }).click();
	await counting;
	await expect(excluded).toBeHidden();
	await expect(page.getByRole("alertdialog")).toHaveCount(0);
	await Promise.all(held.map(async (route) => route.continue()));
	await page.unroute(`**/api/accounts/${account.id}/transactions*`);
	const confirmation = page.getByRole("alertdialog", {
		name: `Supprimer le compte « ${account.name} » et ses 3 opérations ?`,
	});
	await expect(confirmation).toBeVisible();
	await confirmation.getByRole("button", { name: "Supprimer le compte" }).click();
	await expect(page.getByText(`Compte « ${account.name} » supprimé.`)).toBeVisible();
	await expect(confirmation).toBeHidden();
	await expect(row).toHaveCount(0);
	await expect(page).toHaveURL(/\/accounts$/u);
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
	await expect(columnRow(page, account.name)).toHaveCount(0);
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
	await expect(dialog.getByRole("button", { name: "Supprimer le compte" })).toBeEnabled();
	await dialog.getByRole("button", { name: "Annuler" }).click();

	await expect(dialog).toBeHidden();
	await expect(page.getByRole("heading", { level: 1, name: account.name })).toBeVisible();
});
