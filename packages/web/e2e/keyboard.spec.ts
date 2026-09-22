import type { Api } from "./fixtures.ts";
import type { Locator, Page } from "@playwright/test";

import { daysAgo, expect, test, uniqueName } from "./fixtures.ts";

// Story 1.8: command palette and keyboard shortcuts. One database serves the
// whole run, so the palette is narrowed by a unique account name and lists by
// a unique label prefix before anything is asserted on them.

const palette = (page: Page) => page.getByRole("dialog", { name: "Palette de commandes" });

const paletteInput = (page: Page) => palette(page).getByRole("combobox");

const option = (page: Page, name: string | RegExp) => palette(page).getByRole("option", { name });

const rows = (page: Page) => page.getByRole("main").locator("button[data-transaction-id]");

const searchBox = (page: Page) => page.getByRole("searchbox", { name: "Rechercher" });

/** Opens a page and waits for its heading, so its shortcuts are bound. */
async function visit(page: Page, url: string) {
	await page.goto(url);
	await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

async function openPalette(page: Page) {
	await page.keyboard.press("ControlOrMeta+K");
	await expect(paletteInput(page)).toBeFocused();
}

/** An account with three transactions, listed as `<prefix> 01` (most recent) to `<prefix> 03`. */
async function threeRows(api: Api, prefix: string) {
	const account = await api.openAccount();
	await api.addDailyTransactions(account.id, 3, prefix);

	return account;
}

/** Hovers a control and returns its tooltip, once the previous one is gone. */
async function hoverTooltip(page: Page, target: Locator) {
	// In steps: Radix keeps a tooltip open while the pointer may still be
	// heading for it, and closes it on a later move.
	await page.mouse.move(0, 0, { steps: 5 });
	await expect(page.getByRole("tooltip")).toHaveCount(0);
	await target.hover();
	const tooltip = page.getByRole("tooltip");
	await expect(tooltip).toBeVisible();

	return tooltip;
}

test("⌘K opens the palette with its three groups, and Esc gives focus back", async ({
	page,
	api,
}) => {
	await api.openAccount();
	await visit(page, "/comptes");
	const link = page.locator('[data-sidebar="sidebar"]').getByRole("link", { name: "Opérations" });
	await link.focus();

	await openPalette(page);

	await expect(palette(page).getByRole("group", { name: "Aller à" })).toBeVisible();
	await expect(palette(page).getByRole("group", { name: "Actions" })).toBeVisible();
	await expect(palette(page).getByRole("group", { name: "Comptes" })).toBeVisible();

	await page.keyboard.press("Escape");

	await expect(palette(page)).toBeHidden();
	await expect(link).toBeFocused();
});

test("typing an account's name then Enter opens that account", async ({ page, api }) => {
	const livret = await api.openAccount({ name: uniqueName("Livret A"), kind: "savings" });

	await visit(page, "/operations");
	await openPalette(page);
	await paletteInput(page).fill(livret.name.toLowerCase());
	await expect(option(page, new RegExp(livret.name))).toBeVisible();
	await page.keyboard.press("Enter");

	await expect(page).toHaveURL(new RegExp(`/comptes/${livret.id}$`, "u"));
	await expect(page.getByRole("heading", { level: 1, name: livret.name })).toBeVisible();
	await expect(palette(page)).toBeHidden();
});

test("the palette matches without accents", async ({ page }) => {
	await visit(page, "/comptes");
	await openPalette(page);
	await paletteInput(page).fill("operations");

	await expect(option(page, /^Opérations/u)).toBeVisible();
});

test("a deactivated account is not in the « Comptes » group", async ({ page, api, request }) => {
	const prefix = uniqueName("Palette");
	const active = await api.openAccount({ name: `${prefix} actif` });
	const inactive = await api.openAccount({ name: `${prefix} inactif` });
	const response = await request.patch(`/api/accounts/${inactive.id}`, {
		data: { active: false },
	});
	expect(response.ok()).toBe(true);

	await visit(page, "/comptes");
	await openPalette(page);
	await paletteInput(page).fill(prefix);

	await expect(option(page, new RegExp(active.name))).toBeVisible();
	await expect(option(page, new RegExp(inactive.name))).toHaveCount(0);
});

test("the palette runs the page's actions and adds an account from anywhere", async ({
	page,
	api,
}) => {
	const account = await api.openAccount();

	await visit(page, `/comptes/${account.id}`);
	await expect(page.getByRole("heading", { level: 1, name: account.name })).toBeVisible();
	await openPalette(page);
	await paletteInput(page).fill("ajouter une operation");
	await page.keyboard.press("Enter");

	await expect(page.getByRole("dialog", { name: "Ajouter une opération" })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog", { name: "Ajouter une opération" })).toBeHidden();

	await visit(page, "/operations");
	await openPalette(page);
	await expect(option(page, /^Ajouter une opération/u)).toHaveCount(0);
	await paletteInput(page).fill("ajouter un compte");
	await page.keyboard.press("Enter");

	await expect(page.getByRole("dialog", { name: "Ajouter un compte" })).toBeVisible();
});

test("the palette records a snapshot on an account page and switches the theme", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingDate: daysAgo(30) });

	await visit(page, `/comptes/${account.id}`);
	await expect(page.getByRole("heading", { level: 1, name: account.name })).toBeVisible();
	await openPalette(page);
	await paletteInput(page).fill("enregistrer un solde");
	await page.keyboard.press("Enter");
	await expect(page.getByRole("dialog", { name: "Ajouter un solde" })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog", { name: "Ajouter un solde" })).toBeHidden();

	await openPalette(page);
	await paletteInput(page).fill("theme sombre");
	await page.keyboard.press("Enter");
	await expect(page.locator("html")).toHaveClass(/dark/u);

	await openPalette(page);
	await paletteInput(page).fill("theme clair");
	await page.keyboard.press("Enter");
	await expect(page.locator("html")).not.toHaveClass(/dark/u);
});

test("the palette offers no snapshot on an account opened today", async ({ page, api }) => {
	const account = await api.openAccount({ openingDate: daysAgo(0) });

	await visit(page, `/comptes/${account.id}`);
	await expect(page.getByRole("heading", { level: 1, name: account.name })).toBeVisible();
	await openPalette(page);
	await paletteInput(page).fill("enregistrer un solde");

	await expect(option(page, /^Enregistrer un solde/u)).toHaveCount(0);
});

test("g c and g o go to the accounts and the transactions", async ({ page }) => {
	await visit(page, "/operations");
	await expect(page.getByRole("heading", { level: 1, name: "Opérations" })).toBeVisible();

	await page.keyboard.press("g");
	await page.keyboard.press("c");
	await expect(page).toHaveURL(/\/comptes\/?$/u);

	await page.keyboard.press("g");
	await page.keyboard.press("o");
	await expect(page).toHaveURL(/\/operations$/u);
});

test("⌘K opens the palette from the search field, and Esc gives focus back to it", async ({
	page,
}) => {
	const prefix = uniqueName("Champ");

	await visit(page, `/operations?q=${encodeURIComponent(prefix)}`);
	await searchBox(page).focus();
	await openPalette(page);
	await page.keyboard.press("Escape");

	await expect(palette(page)).toBeHidden();
	await expect(searchBox(page)).toBeFocused();
});

test("Enter on a control other than a row keeps its own action", async ({ page }) => {
	await visit(page, "/operations");
	await page
		.locator('[data-sidebar="sidebar"]')
		.getByRole("link", { name: "Comptes", exact: true })
		.focus();
	await page.keyboard.press("Enter");

	await expect(page).toHaveURL(/\/comptes\/?$/u);
});

test("letters typed in a field stay in the field", async ({ page }) => {
	await visit(page, "/operations");
	await searchBox(page).click();
	await page.keyboard.type("gc");

	await expect(searchBox(page)).toHaveValue("gc");
	await expect(page).toHaveURL(/\/operations/u);
});

test("no shortcut fires while a sheet is open", async ({ page, api }) => {
	const account = await api.openAccount();
	const label = uniqueName("Calque");
	await api.addTransaction(account.id, { date: daysAgo(2), label, amount: "-1" });

	await visit(page, `/comptes/${account.id}`);
	await rows(page).first().click();
	const sheet = page.getByRole("dialog", { name: "Modifier l'opération" });
	await expect(sheet).toBeVisible();
	await sheet.getByRole("switch", { name: "Exclure des rapports" }).focus();

	await page.keyboard.press("ControlOrMeta+K");
	await page.keyboard.press("g");
	await page.keyboard.press("o");

	await expect(palette(page)).toBeHidden();
	await expect(page).toHaveURL(new RegExp(`/comptes/${account.id}$`, "u"));
	await expect(sheet).toBeVisible();
});

test("j, j, j, k then e open the second row, and / focuses the search", async ({ page, api }) => {
	const prefix = uniqueName("Clavier");
	await threeRows(api, prefix);

	await visit(page, `/operations?q=${encodeURIComponent(prefix)}`);
	await expect(rows(page)).toHaveCount(3);

	await page.keyboard.press("j");
	await expect(rows(page).nth(0)).toBeFocused();
	await page.keyboard.press("j");
	await expect(rows(page).nth(1)).toBeFocused();
	await page.keyboard.press("j");
	await expect(rows(page).nth(2)).toBeFocused();
	await page.keyboard.press("k");
	await expect(rows(page).nth(1)).toBeFocused();
	await page.keyboard.press("e");

	const sheet = page.getByRole("dialog", { name: "Modifier l'opération" });
	await expect(sheet.getByLabel("Libellé")).toHaveValue(`${prefix} 02`);
	await page.keyboard.press("Escape");
	await expect(sheet).toBeHidden();
	await expect(rows(page).nth(1)).toBeFocused();

	await page.keyboard.press("Shift+/");

	await expect(searchBox(page)).toBeFocused();
	await expect(searchBox(page)).toHaveValue(prefix);
});

test("Enter opens the focused row, and the arrows move once a row has focus", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Flèches");
	await threeRows(api, prefix);

	await visit(page, `/operations?q=${encodeURIComponent(prefix)}`);
	await expect(rows(page)).toHaveCount(3);

	await page.keyboard.press("ArrowDown");
	await expect(page.locator(":focus")).toHaveCount(0);

	await page.keyboard.press("j");
	await expect(rows(page).nth(0)).toBeFocused();
	await page.keyboard.press("ArrowDown");
	await expect(rows(page).nth(1)).toBeFocused();
	await page.keyboard.press("ArrowDown");
	await expect(rows(page).nth(2)).toBeFocused();
	await page.keyboard.press("ArrowUp");
	await expect(rows(page).nth(1)).toBeFocused();

	await page.keyboard.press("Enter");
	await expect(
		page.getByRole("dialog", { name: "Modifier l'opération" }).getByLabel("Libellé"),
	).toHaveValue(`${prefix} 02`);
});

test("j on the last row keeps the focus there", async ({ page, api }) => {
	const prefix = uniqueName("Fin");
	await threeRows(api, prefix);

	await visit(page, `/operations?q=${encodeURIComponent(prefix)}`);
	await expect(rows(page)).toHaveCount(3);
	await rows(page).nth(2).focus();

	await page.keyboard.press("j");

	await expect(rows(page).nth(2)).toBeFocused();
});

test("j and k work on the account page's Opérations tab", async ({ page, api }) => {
	const prefix = uniqueName("Onglet");
	const account = await threeRows(api, prefix);

	await visit(page, `/comptes/${account.id}`);
	await expect(rows(page)).toHaveCount(3);
	await page.keyboard.press("j");
	await page.keyboard.press("j");
	await expect(rows(page).nth(1)).toBeFocused();
	await page.keyboard.press("k");

	await expect(rows(page).nth(0)).toBeFocused();
});

test("/ does nothing on an account page", async ({ page, api }) => {
	const account = await api.openAccount();

	await visit(page, `/comptes/${account.id}`);
	await expect(page.getByRole("heading", { level: 1, name: account.name })).toBeVisible();
	await page.keyboard.press("Shift+/");

	await expect(page.locator(":focus")).toHaveCount(0);
	await expect(page).toHaveURL(new RegExp(`/comptes/${account.id}$`, "u"));
});

test("n opens the new-transaction sheet on an account page", async ({ page, api }) => {
	const account = await api.openAccount();

	await visit(page, `/comptes/${account.id}`);
	await expect(page.getByRole("heading", { level: 1, name: account.name })).toBeVisible();
	await page.keyboard.press("n");

	await expect(page.getByRole("dialog", { name: "Ajouter une opération" })).toBeVisible();
});

test("? lists every shortcut, and the sidebar shows G C on Comptes", async ({ page }) => {
	await visit(page, "/comptes");
	await page.keyboard.press("Shift+?");

	const dialog = page.getByRole("dialog", { name: "Raccourcis clavier" });
	await expect(dialog).toBeVisible();
	// Every entry of the catalogue, by section, with its keys.
	await expect(dialog.locator("dl > div")).toHaveText([
		/^Ouvrir la palette de commandes(⌘K|Ctrl K)$/u,
		/^Réduire ou déplier la barre latérale(⌘B|Ctrl B)$/u,
		"Afficher les raccourcis?",
		"Aller aux comptesG C",
		"Aller aux opérationsG O",
		"Ajouter une opération sur la page d'un compteN",
		"Importer un fichier sur la page d'un compteI",
		"Rechercher dans les opérations/",
		"Opération suivanteJ ou ↓",
		"Opération précédenteK ou ↑",
		"Ouvrir l'opérationE ou ↵",
	]);
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();

	const sidebar = page.locator('[data-sidebar="sidebar"]');
	await expect(
		await hoverTooltip(page, sidebar.getByRole("link", { name: "Comptes", exact: true })),
	).toHaveText("Comptes G C");
	await expect(
		await hoverTooltip(page, sidebar.getByRole("link", { name: "Opérations", exact: true })),
	).toHaveText("Opérations G O");
});

test("the header buttons open the palette and the shortcuts, showing their keys", async ({
	page,
}) => {
	await visit(page, "/comptes");

	const search = page.getByRole("button", { name: "Commandes", exact: true });
	await expect(await hoverTooltip(page, search)).toHaveText(/^Palette de commandes (⌘K|Ctrl K)$/u);
	await search.click();
	await expect(palette(page)).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(palette(page)).toBeHidden();
	// Focus comes back to the button once the palette's exit animation ends,
	// and opens its tooltip; on a slow CI runner that happened after the next
	// hover began, leaving the tooltip up. Wait for it, then close it with Esc.
	await expect(search).toBeFocused();
	await page.keyboard.press("Escape");

	const toggle = page.getByRole("button", { name: "Réduire ou déplier la barre latérale" }).first();
	await expect(await hoverTooltip(page, toggle)).toHaveText(
		/^Réduire ou déplier la barre latérale (⌘B|Ctrl B)$/u,
	);

	const help = page.getByRole("button", { name: "Raccourcis clavier", exact: true });
	await expect(await hoverTooltip(page, help)).toHaveText("Raccourcis clavier ?");
	await help.click();
	await expect(page.getByRole("dialog", { name: "Raccourcis clavier" })).toBeVisible();
});

test("the search field and « Ajouter une opération » show their keys", async ({ page, api }) => {
	const account = await api.openAccount();

	await visit(page, "/operations");
	await expect(await hoverTooltip(page, searchBox(page))).toHaveText("Rechercher /");
	await page.mouse.move(0, 0);

	await visit(page, `/comptes/${account.id}`);
	await expect(
		await hoverTooltip(
			page,
			page.getByRole("main").getByRole("button", { name: "Ajouter une opération" }).first(),
		),
	).toHaveText("Ajouter une opération N");
});
