import type { Api } from "./fixtures.ts";
import type { Page } from "@playwright/test";

import { daysAgo, expect, test, uniqueName } from "./fixtures.ts";

// Story 4.3: merchant management under « Réglages ». One database serves the
// whole run, so each test works on merchants of its own.

const PAGE = "/reglages/marchands";

const merchantRow = (page: Page, name: string) =>
	page.getByRole("button", { name: `Actions pour ${name}`, exact: true }).locator("..");

async function openAction(
	page: Page,
	name: string,
	action: "Renommer" | "Fusionner" | "Supprimer",
) {
	await page.getByRole("button", { name: `Actions pour ${name}`, exact: true }).click();
	await page.getByRole("menuitem", { name: action }).click();
}

/** A transaction labelled `label`, linked to the merchant. */
async function linked(api: Api, label: string, merchantId: string) {
	const account = await api.openAccount();
	const id = await api.addTransaction(account.id, { date: daysAgo(2), label, amount: "-9,90" });
	await api.setMerchant([id], merchantId);
}

const rowButton = (page: Page, label: string) =>
	page
		.getByRole("main")
		.getByRole("listitem")
		.filter({ hasText: label })
		.locator("button[data-transaction-id]");

async function visitOperations(page: Page, q: string) {
	await page.goto(`/operations?q=${encodeURIComponent(q)}`);
	await expect(rowButton(page, q)).toBeVisible();
}

test("renaming a merchant renames it on its rows", async ({ page, api }) => {
	const label = uniqueName("CB CARREF");
	const merchant = await api.createMerchant(uniqueName("Carref"));
	const renamed = uniqueName("Carrefour");
	await linked(api, label, merchant.id);

	await page.goto(PAGE);
	await expect(page.getByRole("heading", { level: 2, name: "Marchands" })).toBeVisible();
	await expect(merchantRow(page, merchant.name)).toContainText("1 opération");
	await openAction(page, merchant.name, "Renommer");
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Nom").fill(renamed);
	await dialog.getByRole("button", { name: "Renommer" }).click();

	await expect(dialog).toBeHidden();
	await expect(merchantRow(page, renamed)).toBeVisible();
	await visitOperations(page, label);
	await expect(rowButton(page, label)).toContainText(renamed);
});

test("merging a merchant into another moves its rows and removes it", async ({ page, api }) => {
	const label = uniqueName("CB LECLERC");
	const source = await api.createMerchant(uniqueName("Leclerc Drive"));
	const target = await api.createMerchant(uniqueName("Leclerc"));
	await linked(api, label, source.id);

	await page.goto(PAGE);
	await openAction(page, source.name, "Fusionner");
	const dialog = page.getByRole("dialog", { name: `Fusionner « ${source.name} »` });
	await dialog.getByRole("button", { name: "Fusionner dans" }).click();
	const search = page.getByRole("combobox", { name: "Rechercher un marchand" });
	await search.fill(target.name);
	// Neither « Sans marchand », nor « Créer », nor the merchant itself.
	await expect(page.getByRole("option", { name: "Sans marchand" })).toHaveCount(0);
	await expect(page.getByRole("option", { name: /^Créer/u })).toHaveCount(0);
	await search.fill(source.name);
	await expect(page.getByRole("option", { name: source.name })).toHaveCount(0);
	await search.fill(target.name);
	await page.getByRole("option", { name: target.name }).click();
	await dialog.getByRole("button", { name: "Fusionner", exact: true }).click();

	await expect(dialog).toBeHidden();
	await expect(merchantRow(page, source.name)).toHaveCount(0);
	await expect(merchantRow(page, target.name)).toContainText("1 opération");
	await visitOperations(page, label);
	await expect(rowButton(page, label)).toContainText(target.name);
});

test("deleting a used merchant, once confirmed, leaves its rows without a merchant", async ({
	page,
	api,
}) => {
	const label = uniqueName("CB MONOP");
	const merchant = await api.createMerchant(uniqueName("Monoprix"));
	await linked(api, label, merchant.id);

	await page.goto(PAGE);
	await openAction(page, merchant.name, "Supprimer");
	const dialog = page.getByRole("alertdialog");
	await expect(dialog).toContainText("1 opération perdra son marchand.");
	await dialog.getByRole("button", { name: "Supprimer" }).click();

	await expect(dialog).toBeHidden();
	await expect(merchantRow(page, merchant.name)).toHaveCount(0);
	await visitOperations(page, label);
	await expect(rowButton(page, label)).not.toContainText(merchant.name);
});
