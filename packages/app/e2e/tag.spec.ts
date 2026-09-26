import type { Api } from "./fixtures.ts";
import type { Page } from "@playwright/test";

import { daysAgo, expect, test, uniqueName } from "./fixtures.ts";

// Story 4.4: tag transactions and filter by tag. One database serves the
// whole run, so every test narrows the list to its own rows by a unique
// label, and names its tags uniquely.

const rowItem = (page: Page, label: string) =>
	page.getByRole("main").getByRole("listitem").filter({ hasText: label });

/** The row's open button, which carries the tags as badges on the caption line. */
const rowButton = (page: Page, label: string) =>
	rowItem(page, label).locator("button[data-transaction-id]");

const tagSearch = (page: Page) => page.getByRole("combobox", { name: "Rechercher une étiquette" });

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

test("a tag added in the sheet shows on the row once saved", async ({ page, api }) => {
	const label = uniqueName("PEINTURE");
	const tag = await api.createTag(uniqueName("Travaux"));
	await oneTransaction(api, label);

	await visitOperations(page, label);
	await rowButton(page, label).click();
	const sheet = page.getByRole("dialog", { name: "Modifier l'opération" });
	const field = sheet.getByRole("button", { name: "Étiquettes", exact: true });
	await expect(field).toHaveText("Aucune étiquette");
	await field.click();
	await tagSearch(page).fill(tag.name);
	await page.getByRole("option", { name: tag.name }).click();
	await page.keyboard.press("Escape");
	await expect(field).toHaveText(tag.name);
	await sheet.getByRole("button", { name: "Enregistrer" }).click();

	await expect(sheet).toBeHidden();
	await expect(rowButton(page, label)).toContainText(tag.name);
});

test("the sheet saves another field when one of its tags was deleted since it opened", async ({
	page,
	api,
}) => {
	const label = uniqueName("CAMPING");
	// Still matched by the list's `q`, which is the old label.
	const renamed = `${label} Ardèche`;
	const tag = await api.createTag(uniqueName("Été"));
	await api.setTags([await oneTransaction(api, label)], [tag.id]);

	await visitOperations(page, label);
	await rowButton(page, label).click();
	const sheet = page.getByRole("dialog", { name: "Modifier l'opération" });
	await expect(sheet.getByRole("button", { name: "Étiquettes", exact: true })).toHaveText(tag.name);
	await api.deleteTag(tag.id);
	await sheet.getByLabel("Libellé").fill(renamed);
	await sheet.getByRole("button", { name: "Enregistrer" }).click();

	await expect(sheet).toBeHidden();
	await expect(rowButton(page, renamed)).toBeVisible();
});

test("the tag filter keeps the tagged rows only, and names the tag in its chip", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Filtre");
	const account = await api.openAccount();
	const holidays = await api.createTag(uniqueName("Vacances"));
	const other = await api.createTag(uniqueName("Travaux"));
	const add = (label: string, days: number) =>
		api.addTransaction(account.id, {
			date: daysAgo(days),
			label: `${prefix} ${label}`,
			amount: "-1",
		});
	await api.setTags([await add("HOTEL", 1)], [holidays.id, other.id]);
	await api.setTags([await add("TRAIN", 2)], [holidays.id]);
	await api.setTags([await add("PEINTURE", 3)], [other.id]);
	await add("Virement", 4);
	const rows = page.getByRole("main").getByRole("listitem");

	await visitOperations(page, prefix);
	await expect(rows).toHaveCount(4);

	await page.getByRole("button", { name: "Filtrer" }).click();
	const menu = page.getByRole("dialog");
	await menu.getByRole("button", { name: "Étiquette", exact: true }).click();
	await menu.getByRole("searchbox", { name: "Rechercher une étiquette" }).fill(holidays.name);
	await expect(menu.getByLabel(other.name)).toHaveCount(0);
	await menu.getByLabel(holidays.name).check();
	await menu.getByRole("button", { name: "Appliquer" }).click();

	await expect(
		page.getByRole("button", { name: `Retirer le filtre ${holidays.name}` }),
	).toBeVisible();
	await expect(rows).toHaveText([
		new RegExp(`${prefix} HOTEL`, "u"),
		new RegExp(`${prefix} TRAIN`, "u"),
	]);
	await expect(page).toHaveURL(/[?&]tag=/u);
});
