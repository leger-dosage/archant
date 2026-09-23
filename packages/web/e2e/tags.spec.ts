import type { Api } from "./fixtures.ts";
import type { Page } from "@playwright/test";

import { daysAgo, expect, test, uniqueName } from "./fixtures.ts";

// Story 4.4: tag management under « Réglages ». One database serves the
// whole run, so each test works on tags of its own.

const PAGE = "/reglages/etiquettes";

const tagRow = (page: Page, name: string) =>
	page.getByRole("button", { name: `Actions pour ${name}`, exact: true }).locator("..");

async function openAction(page: Page, name: string, action: "Renommer" | "Supprimer") {
	await page.getByRole("button", { name: `Actions pour ${name}`, exact: true }).click();
	await page.getByRole("menuitem", { name: action }).click();
}

/** A transaction labelled `label`, carrying the tag. */
async function tagged(api: Api, label: string, tagId: string) {
	const account = await api.openAccount();
	const id = await api.addTransaction(account.id, { date: daysAgo(2), label, amount: "-9,90" });
	await api.setTags([id], [tagId]);
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

test("renaming a tag renames it on its rows", async ({ page, api }) => {
	const label = uniqueName("HOTEL");
	const tag = await api.createTag(uniqueName("Vacnces"));
	const renamed = uniqueName("Vacances");
	await tagged(api, label, tag.id);

	await page.goto(PAGE);
	await expect(page.getByRole("heading", { level: 2, name: "Étiquettes" })).toBeVisible();
	await expect(tagRow(page, tag.name)).toContainText("1 opération");
	await openAction(page, tag.name, "Renommer");
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Nom").fill(renamed);
	await dialog.getByRole("button", { name: "Renommer" }).click();

	await expect(dialog).toBeHidden();
	await expect(tagRow(page, renamed)).toBeVisible();
	await visitOperations(page, label);
	await expect(rowButton(page, label)).toContainText(renamed);
});

test("deleting a used tag, once confirmed, takes it off its rows", async ({ page, api }) => {
	const label = uniqueName("PEINTURE");
	const tag = await api.createTag(uniqueName("Travaux"));
	await tagged(api, label, tag.id);

	await page.goto(PAGE);
	await openAction(page, tag.name, "Supprimer");
	const dialog = page.getByRole("alertdialog");
	await expect(dialog).toContainText("1 opération perdra cette étiquette.");
	await dialog.getByRole("button", { name: "Supprimer" }).click();

	await expect(dialog).toBeHidden();
	await expect(tagRow(page, tag.name)).toHaveCount(0);
	await visitOperations(page, label);
	await expect(rowButton(page, label)).not.toContainText(tag.name);
});
