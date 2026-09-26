import type { Api } from "./fixtures.ts";
import type { Page, Route } from "@playwright/test";

import { daysAgo, expect, test, uniqueName } from "./fixtures.ts";

// Story 4.2: categorise transactions and filter by category. One database
// serves the whole run, so every test narrows the list to its own rows by a
// unique label, and never changes a default category.

/** A transaction's row: its open button and, beside it, its category chip. */
const rowItem = (page: Page, label: string) =>
	page.getByRole("main").getByRole("listitem").filter({ hasText: label });

const chipOf = (page: Page, label: string, name: string) =>
	rowItem(page, label).getByRole("button", { name: `Catégorie : ${name}`, exact: true });

const rowButton = (page: Page, label: string) =>
	rowItem(page, label).locator("button[data-transaction-id]");

/** A gate a routed request waits on, so a test sees the page before the answer arrives. */
function gate() {
	let release: (() => void) | undefined;
	const opened = new Promise<void>((resolve) => {
		release = resolve;
	});

	return { opened, open: () => release?.() };
}

/** Holds every PATCH of a transaction until `until` resolves, then lets `answer` reply. */
async function holdPatches(
	page: Page,
	until: Promise<void>,
	answer: (route: Route) => Promise<void>,
) {
	await page.route("**/api/transactions/*", async (route) => {
		if (route.request().method() !== "PATCH") {
			await route.fallback();

			return;
		}

		await until;
		await answer(route);
	});
}

const categorySearch = (page: Page) =>
	page.getByRole("combobox", { name: "Rechercher une catégorie" });

const toast = (page: Page, text: string) =>
	page.locator("[data-sonner-toast]").filter({ hasText: text });

/** Opens `/transactions` on the rows labelled with `q`, and waits for them. */
async function visitOperations(page: Page, q: string) {
	await page.goto(`/transactions?q=${encodeURIComponent(q)}`);
	await expect(page.getByRole("heading", { level: 1, name: "Opérations" })).toBeVisible();
	await expect(rowItem(page, q).first()).toBeVisible();
}

async function oneTransaction(api: Api, label: string) {
	const account = await api.openAccount();

	return api.addTransaction(account.id, { date: daysAgo(2), label, amount: "-42,90" });
}

/** Opens the « Filtrer » menu on the category editor. */
async function openCategoryFilter(page: Page) {
	await page.getByRole("button", { name: "Filtrer" }).click();
	const menu = page.getByRole("dialog");
	await menu.getByRole("button", { name: "Catégorie", exact: true }).click();

	return menu;
}

test("typing in a row's category combobox and pressing Enter sets it at once, and it stays after a reload", async ({
	page,
	api,
}) => {
	const label = uniqueName("Marché");
	await oneTransaction(api, label);
	const server = gate();
	await holdPatches(page, server.opened, (route) => route.fallback());

	await visitOperations(page, label);
	await chipOf(page, label, "Sans catégorie").click();
	await expect(categorySearch(page)).toBeFocused();
	await page.keyboard.type("cour");
	await page.keyboard.press("Enter");

	// Before the server has answered: the list changed on its own.
	await expect(chipOf(page, label, "Courses")).toBeVisible();
	server.open();
	await expect(toast(page, "Catégorie modifiée")).toBeVisible();

	await page.reload();
	await expect(chipOf(page, label, "Courses")).toBeVisible();
});

test("a row's category combobox offers no « Créer » for an unknown name", async ({ page, api }) => {
	const label = uniqueName("Marché");
	await oneTransaction(api, label);

	await visitOperations(page, label);
	await chipOf(page, label, "Sans catégorie").click();
	await categorySearch(page).fill(uniqueName("Absente"));

	await expect(page.getByRole("option", { name: /^Créer/u })).toHaveCount(0);
});

test("« Annuler » in the toast puts « Sans catégorie » back", async ({ page, api }) => {
	const label = uniqueName("Épicerie");
	await oneTransaction(api, label);

	await visitOperations(page, label);
	await chipOf(page, label, "Sans catégorie").click();
	await page.keyboard.type("cour");
	await page.keyboard.press("Enter");
	await expect(chipOf(page, label, "Courses")).toBeVisible();
	await toast(page, "Catégorie modifiée").getByRole("button", { name: "Annuler" }).click();

	await expect(chipOf(page, label, "Sans catégorie")).toBeVisible();
	// The undo offers no undo of its own.
	await expect(toast(page, "Catégorie modifiée")).toHaveCount(0);
	await page.reload();
	await expect(chipOf(page, label, "Sans catégorie")).toBeVisible();
});

test("c on a focused row opens its category combobox", async ({ page, api }) => {
	const label = uniqueName("Pharmacie");
	await oneTransaction(api, label);

	await visitOperations(page, label);
	await page.keyboard.press("j");
	await expect(rowButton(page, label)).toBeFocused();
	await page.keyboard.press("c");

	await expect(categorySearch(page)).toBeFocused();
	await expect(page.getByRole("option", { name: "Sans catégorie" })).toBeVisible();

	// Focus goes back to the row, so `j` carries on from there.
	await page.keyboard.press("Escape");
	await expect(categorySearch(page)).toBeHidden();
	await expect(rowButton(page, label)).toBeFocused();

	await page.keyboard.press("c");
	await page.keyboard.type("cour");
	await page.keyboard.press("Enter");
	await expect(chipOf(page, label, "Courses")).toBeVisible();
	await expect(rowButton(page, label)).toBeFocused();

	// The chip names the shortcut in its tooltip.
	await page.mouse.move(0, 0);
	await chipOf(page, label, "Courses").hover();
	await expect(page.getByRole("tooltip")).toHaveText(/Changer la catégorie\s*C/u);
});

test("the category filter keeps « Sans catégorie » rows, or the rows of two categories, and names them in its chip", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Filtre");
	const account = await api.openAccount();
	const leisure = await api.createCategory({ name: uniqueName("Sorties") });
	const health = await api.createCategory({ name: uniqueName("Soins") });
	const other = await api.createCategory({ name: uniqueName("Divers") });
	const add = (label: string, days: number) =>
		api.addTransaction(account.id, {
			date: daysAgo(days),
			label: `${prefix} ${label}`,
			amount: "-1",
		});
	await api.categorise([await add("Cinéma", 1)], leisure.id);
	await api.categorise([await add("Médecin", 2)], health.id);
	await api.categorise([await add("Quincaillerie", 3)], other.id);
	await add("Virement", 4);
	const rows = page.getByRole("main").getByRole("listitem");

	await visitOperations(page, prefix);
	await expect(rows).toHaveCount(4);

	let menu = await openCategoryFilter(page);
	await menu.getByLabel("Sans catégorie").check();
	await menu.getByRole("button", { name: "Appliquer" }).click();

	await expect(
		page.getByRole("button", { name: "Retirer le filtre Sans catégorie" }),
	).toBeVisible();
	await expect(rows).toHaveText([new RegExp(`${prefix} Virement`, "u")]);

	menu = await openCategoryFilter(page);
	await menu.getByLabel("Sans catégorie").uncheck();
	await menu.getByLabel(leisure.name).check();
	await menu.getByLabel(health.name).check();
	await menu.getByRole("button", { name: "Appliquer" }).click();

	await expect(
		page.getByRole("button", { name: `Retirer le filtre ${leisure.name}, ${health.name}` }),
	).toBeVisible();
	await expect(rows).toHaveText([
		new RegExp(`${prefix} Cinéma`, "u"),
		new RegExp(`${prefix} Médecin`, "u"),
	]);
	await expect(page).toHaveURL(/[?&]category=/u);
});

test("a category picked in the sheet shows on the row once saved", async ({ page, api }) => {
	const label = uniqueName("Librairie");
	const category = await api.createCategory({ name: uniqueName("Lectures") });
	await oneTransaction(api, label);

	await visitOperations(page, label);
	await rowButton(page, label).click();
	const sheet = page.getByRole("dialog", { name: "Modifier l'opération" });
	const field = sheet.getByRole("button", { name: "Catégorie", exact: true });
	await expect(field).toHaveText("Sans catégorie");
	await field.click();
	await categorySearch(page).fill(category.name);
	await page.getByRole("option", { name: category.name }).click();
	await expect(field).toHaveText(category.name);
	await sheet.getByRole("button", { name: "Enregistrer" }).click();

	await expect(sheet).toBeHidden();
	await expect(chipOf(page, label, category.name)).toBeVisible();
});

test("a rejected change puts the chip back and shows a destructive toast", async ({
	page,
	api,
}) => {
	const label = uniqueName("Garage");
	await oneTransaction(api, label);
	const server = gate();
	await holdPatches(page, server.opened, (route) =>
		route.fulfill({
			status: 500,
			json: { error: { code: "INTERNAL_ERROR", message: "Something went wrong." } },
		}),
	);

	await visitOperations(page, label);
	// The list's refetch after the failure never answers, so only the rollback
	// can show « Sans catégorie » again.
	let refetched = false;
	await page.route(
		(url) => url.pathname === "/api/transactions",
		() => {
			refetched = true;
		},
	);
	await chipOf(page, label, "Sans catégorie").click();
	await page.keyboard.type("cour");
	await page.keyboard.press("Enter");
	await expect(chipOf(page, label, "Courses")).toBeVisible();
	server.open();

	await expect(
		page.locator('[data-sonner-toast][data-type="error"]').filter({
			hasText: "Une erreur inattendue s'est produite.",
		}),
	).toBeVisible();
	await expect(chipOf(page, label, "Sans catégorie")).toBeVisible();
	await expect(chipOf(page, label, "Courses")).toHaveCount(0);
	// The refetch was sent and is still held: the rollback alone put it back.
	expect(refetched).toBe(true);
});
