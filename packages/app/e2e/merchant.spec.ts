import type { Api } from "./fixtures.ts";
import type { Page } from "@playwright/test";

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
