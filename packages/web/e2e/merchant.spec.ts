import type { Api } from "./fixtures.ts";
import type { Page, Route } from "@playwright/test";

import { daysAgo, expect, test, uniqueName } from "./fixtures.ts";

// Story 4.3: set a transaction's merchant and filter by merchant. One
// database serves the whole run, so every test narrows the list to its own
// rows by a unique label, and names its merchants uniquely.

const rowItem = (page: Page, label: string) =>
	page.getByRole("main").getByRole("listitem").filter({ hasText: label });

/** The row's open button, which carries the merchant as a caption under the label. */
const rowButton = (page: Page, label: string) =>
	rowItem(page, label).locator("button[data-transaction-id]");

const merchantSearch = (page: Page) =>
	page.getByRole("combobox", { name: "Rechercher un marchand" });

const toast = (page: Page, text: string) =>
	page.locator("[data-sonner-toast]").filter({ hasText: text });

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

/** Focuses the row with `j` and opens its merchant combobox with `m`. */
async function pressM(page: Page, label: string) {
	await rowButton(page, label).focus();
	await expect(rowButton(page, label)).toBeFocused();
	await page.keyboard.press("m");
	await expect(merchantSearch(page)).toBeFocused();
}

test("m on a focused row creates a merchant from what is typed, shown under the label and kept after a reload", async ({
	page,
	api,
}) => {
	const label = uniqueName("CB CARREFOUR");
	const name = uniqueName("Carrefour");
	await oneTransaction(api, label);

	await visitOperations(page, label);
	await page.keyboard.press("j");
	await expect(rowButton(page, label)).toBeFocused();
	await page.keyboard.press("m");
	await expect(merchantSearch(page)).toBeFocused();
	await expect(page.getByRole("option", { name: "Sans marchand" })).toBeVisible();
	await page.keyboard.type(name);
	await page.getByRole("option", { name: `Créer "${name}"` }).click();

	await expect(rowButton(page, label)).toContainText(name);
	await expect(toast(page, "Marchand modifié")).toBeVisible();
	// Focus goes back to the row, so `j` carries on from there.
	await expect(rowButton(page, label)).toBeFocused();

	await page.reload();
	await expect(rowButton(page, label)).toContainText(name);
});

test("a merchant that exists is offered as the name is typed, and « Créer » is not offered for its name", async ({
	page,
	api,
}) => {
	const label = uniqueName("CARREFOUR MARKET");
	const merchant = await api.createMerchant(uniqueName("Carrefour"));
	await oneTransaction(api, label);

	await visitOperations(page, label);
	await pressM(page, label);
	await page.keyboard.type("carr");

	await expect(page.getByRole("option", { name: merchant.name })).toBeVisible();

	await merchantSearch(page).fill(merchant.name.toLowerCase());
	await expect(page.getByRole("option", { name: merchant.name })).toBeVisible();
	await expect(page.getByRole("option", { name: /^Créer/u })).toHaveCount(0);

	await page.keyboard.press("Enter");
	await expect(rowButton(page, label)).toContainText(merchant.name);
});

test("« Annuler » in the toast takes the merchant off the row", async ({ page, api }) => {
	const label = uniqueName("LIDL");
	const merchant = await api.createMerchant(uniqueName("Lidl"));
	await oneTransaction(api, label);

	await visitOperations(page, label);
	await pressM(page, label);
	await page.keyboard.type(merchant.name);
	await page.getByRole("option", { name: merchant.name }).click();
	await expect(rowButton(page, label)).toContainText(merchant.name);
	await toast(page, "Marchand modifié").getByRole("button", { name: "Annuler" }).click();

	await expect(rowButton(page, label)).not.toContainText(merchant.name);
	await page.reload();
	await expect(rowButton(page, label)).toBeVisible();
	await expect(rowButton(page, label)).not.toContainText(merchant.name);
});

test("a merchant picked in the sheet shows on the row once saved", async ({ page, api }) => {
	const label = uniqueName("FNAC");
	const merchant = await api.createMerchant(uniqueName("Fnac"));
	await oneTransaction(api, label);

	await visitOperations(page, label);
	await rowButton(page, label).click();
	const sheet = page.getByRole("dialog", { name: "Modifier l'opération" });
	const field = sheet.getByRole("button", { name: "Marchand", exact: true });
	await expect(field).toHaveText("Sans marchand");
	await field.click();
	await merchantSearch(page).fill(merchant.name);
	await page.getByRole("option", { name: merchant.name }).click();
	await expect(field).toHaveText(merchant.name);
	await sheet.getByRole("button", { name: "Enregistrer" }).click();

	await expect(sheet).toBeHidden();
	await expect(rowButton(page, label)).toContainText(merchant.name);
});

test("the sheet saves another field when its merchant was deleted since it opened", async ({
	page,
	api,
}) => {
	const label = uniqueName("CB CASINO");
	// Still matched by the list's `q`, which is the old label.
	const renamed = `${label} Géant`;
	const merchant = await api.createMerchant(uniqueName("Casino"));
	await api.setMerchant([await oneTransaction(api, label)], merchant.id);

	await visitOperations(page, label);
	await rowButton(page, label).click();
	const sheet = page.getByRole("dialog", { name: "Modifier l'opération" });
	await expect(sheet.getByRole("button", { name: "Marchand", exact: true })).toHaveText(
		merchant.name,
	);
	await api.deleteMerchant(merchant.id);
	await sheet.getByLabel("Libellé").fill(renamed);
	await sheet.getByRole("button", { name: "Enregistrer" }).click();

	await expect(sheet).toBeHidden();
	await expect(rowButton(page, renamed)).toBeVisible();
});

test("the merchant filter keeps one merchant's rows, and names it in its chip", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Filtre");
	const account = await api.openAccount();
	const carrefour = await api.createMerchant(uniqueName("Carrefour"));
	const lidl = await api.createMerchant(uniqueName("Lidl"));
	const add = (label: string, days: number) =>
		api.addTransaction(account.id, {
			date: daysAgo(days),
			label: `${prefix} ${label}`,
			amount: "-1",
		});
	await api.setMerchant(
		[await add("CB CARREFOUR", 1), await add("CARREFOUR CITY", 2)],
		carrefour.id,
	);
	await api.setMerchant([await add("LIDL", 3)], lidl.id);
	await add("Virement", 4);
	const rows = page.getByRole("main").getByRole("listitem");

	await visitOperations(page, prefix);
	await expect(rows).toHaveCount(4);

	await page.getByRole("button", { name: "Filtrer" }).click();
	const menu = page.getByRole("dialog");
	await menu.getByRole("button", { name: "Marchand", exact: true }).click();
	await menu.getByRole("searchbox", { name: "Rechercher un marchand" }).fill(carrefour.name);
	await expect(menu.getByLabel(lidl.name)).toHaveCount(0);
	await menu.getByLabel(carrefour.name).check();
	await menu.getByRole("button", { name: "Appliquer" }).click();

	await expect(
		page.getByRole("button", { name: `Retirer le filtre ${carrefour.name}` }),
	).toBeVisible();
	await expect(rows).toHaveText([
		new RegExp(`${prefix} CB CARREFOUR`, "u"),
		new RegExp(`${prefix} CARREFOUR CITY`, "u"),
	]);
	await expect(page).toHaveURL(/[?&]merchant=/u);
});

test("a rejected change puts the previous merchant back and shows a destructive toast", async ({
	page,
	api,
}) => {
	const label = uniqueName("DARTY");
	const before = await api.createMerchant(uniqueName("Darty"));
	const after = await api.createMerchant(uniqueName("Boulanger"));
	await api.setMerchant([await oneTransaction(api, label)], before.id);
	const server = gate();
	await holdPatches(page, server.opened, (route) =>
		route.fulfill({
			status: 500,
			json: { error: { code: "INTERNAL_ERROR", message: "Something went wrong." } },
		}),
	);

	await visitOperations(page, label);
	await expect(rowButton(page, label)).toContainText(before.name);
	// The list's refetch after the failure never answers, so only the rollback
	// can show the previous merchant again.
	let refetched = false;
	await page.route(
		(url) => url.pathname === "/api/transactions",
		() => {
			refetched = true;
		},
	);
	await pressM(page, label);
	await page.keyboard.type(after.name);
	await page.getByRole("option", { name: after.name }).click();
	await expect(rowButton(page, label)).toContainText(after.name);
	server.open();

	await expect(
		page.locator('[data-sonner-toast][data-type="error"]').filter({
			hasText: "Une erreur inattendue s'est produite.",
		}),
	).toBeVisible();
	await expect(rowButton(page, label)).toContainText(before.name);
	await expect(rowButton(page, label)).not.toContainText(after.name);
	expect(refetched).toBe(true);
});
