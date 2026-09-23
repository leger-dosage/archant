import type { Api } from "./fixtures.ts";
import type { Page } from "@playwright/test";

import { daysAgo, euros, expect, test, uniqueName } from "./fixtures.ts";

// Story 4.5: bulk edit. One database serves the whole run, so every test
// narrows the list to its own rows by a unique label prefix.

const rowItem = (page: Page, label: string) =>
	page.getByRole("main").getByRole("listitem").filter({ hasText: label });

const rowButton = (page: Page, label: string) =>
	rowItem(page, label).locator("button[data-transaction-id]");

const checkbox = (page: Page, label: string) =>
	page.getByRole("checkbox", { name: `Sélectionner « ${label} »`, exact: true });

const bar = (page: Page) => page.getByRole("toolbar", { name: "Actions sur la sélection" });

const toast = (page: Page, text: string) =>
	page.locator("[data-sonner-toast]").filter({ hasText: text });

const categorySearch = (page: Page) =>
	page.getByRole("combobox", { name: "Rechercher une catégorie" });

/** `<prefix> 01` (yesterday, listed first) to `<prefix> NN`. */
const labelOf = (prefix: string, day: number) => `${prefix} ${String(day).padStart(2, "0")}`;

/** An account holding `count` rows of -1,00, one a day, from 1 000,00. */
async function withRows(api: Api, prefix: string, count = 3) {
	const account = await api.openAccount({ openingDate: daysAgo(count + 10) });
	await api.addDailyTransactions(account.id, count, prefix);

	return account;
}

/** Opens `/operations` on the rows labelled with `q`, and waits for them. */
async function visitOperations(page: Page, q: string, extra = "") {
	await page.goto(`/operations?q=${encodeURIComponent(q)}${extra}`);
	await expect(page.getByRole("heading", { level: 1, name: "Opérations" })).toBeVisible();
	await expect(rowItem(page, q).first()).toBeVisible();
}

/** Ticks rows by their checkbox, one after the other. */
async function tick(page: Page, labels: string[]) {
	await labels.reduce(async (previous, label) => {
		await previous;
		await checkbox(page, label).click();
	}, Promise.resolve());
}

test("ticking two rows shows « 2 sélectionnées », and Esc hides the bar", async ({ page, api }) => {
	const prefix = uniqueName("Tri");
	await withRows(api, prefix);

	await visitOperations(page, prefix);
	await tick(page, [labelOf(prefix, 1), labelOf(prefix, 3)]);

	await expect(bar(page)).toContainText("2 sélectionnées");
	await expect(checkbox(page, labelOf(prefix, 2))).not.toBeChecked();
	await page.keyboard.press("Escape");

	await expect(bar(page)).toBeHidden();
	await expect(checkbox(page, labelOf(prefix, 1))).not.toBeChecked();
});

test("Esc closing the bar's category list keeps the selection", async ({ page, api }) => {
	const prefix = uniqueName("Fermer");
	await withRows(api, prefix);

	await visitOperations(page, prefix);
	await tick(page, [labelOf(prefix, 1), labelOf(prefix, 2)]);
	await bar(page).getByRole("button", { name: "Catégorie" }).click();
	await expect(categorySearch(page)).toBeFocused();
	await page.keyboard.press("Escape");

	await expect(categorySearch(page)).toBeHidden();
	await expect(bar(page)).toContainText("2 sélectionnées");
	await expect(checkbox(page, labelOf(prefix, 1))).toBeChecked();
});

test("changing the search clears the selection", async ({ page, api }) => {
	const prefix = uniqueName("Portée");
	await withRows(api, prefix);

	await visitOperations(page, prefix);
	await tick(page, [labelOf(prefix, 1)]);
	await expect(bar(page)).toContainText("1 sélectionnée");
	await page.getByRole("searchbox", { name: "Rechercher" }).fill(labelOf(prefix, 1));

	await expect(rowItem(page, labelOf(prefix, 2))).toHaveCount(0);
	await expect(bar(page)).toBeHidden();
	await expect(checkbox(page, labelOf(prefix, 1))).not.toBeChecked();
});

test("x then Shift+j twice selects three rows", async ({ page, api }) => {
	const prefix = uniqueName("Clavier");
	await withRows(api, prefix, 4);

	await visitOperations(page, prefix);
	await page.keyboard.press("j");
	await expect(rowButton(page, labelOf(prefix, 1))).toBeFocused();
	await page.keyboard.press("x");
	await page.keyboard.press("Shift+J");
	await page.keyboard.press("Shift+J");

	await expect(rowButton(page, labelOf(prefix, 3))).toBeFocused();
	await expect(bar(page)).toContainText("3 sélectionnées");
	await Promise.all(
		[1, 2, 3].map((day) => expect(checkbox(page, labelOf(prefix, day))).toBeChecked()),
	);
	await expect(checkbox(page, labelOf(prefix, 4))).not.toBeChecked();
});

test("Shift+click on a checkbox two rows below the ticked one selects the three", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Plage");
	await withRows(api, prefix, 4);

	await visitOperations(page, prefix);
	await checkbox(page, labelOf(prefix, 1)).click();
	await checkbox(page, labelOf(prefix, 3)).click({ modifiers: ["Shift"] });

	await expect(bar(page)).toContainText("3 sélectionnées");
	await expect(checkbox(page, labelOf(prefix, 2))).toBeChecked();
	await expect(checkbox(page, labelOf(prefix, 4))).not.toBeChecked();
});

test("a category picked in the bar lands on every selected row and clears the selection", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Marché");
	await withRows(api, prefix);

	await visitOperations(page, prefix);
	await tick(page, [labelOf(prefix, 1), labelOf(prefix, 2)]);
	await bar(page).getByRole("button", { name: "Catégorie" }).click();
	await page.keyboard.type("cour");
	await page.keyboard.press("Enter");

	await expect(toast(page, "Catégorie modifiée sur 2 opérations")).toBeVisible();
	await expect(bar(page)).toBeHidden();
	await expect(checkbox(page, labelOf(prefix, 1))).not.toBeChecked();
	await page.reload();
	const chip = (day: number, name: string) =>
		rowItem(page, labelOf(prefix, day)).getByRole("button", { name: `Catégorie : ${name}` });
	await expect(chip(1, "Courses")).toBeVisible();
	await expect(chip(2, "Courses")).toBeVisible();
	await expect(chip(3, "Sans catégorie")).toBeVisible();
});

test("a merchant, a tag and the exclusion set in the bar show on every selected row", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Voyage");
	const merchant = await api.createMerchant(uniqueName("SNCF"));
	const tag = await api.createTag(uniqueName("Vacances"));
	await withRows(api, prefix);
	const labels = [labelOf(prefix, 1), labelOf(prefix, 2)];

	await visitOperations(page, prefix);
	await tick(page, labels);
	await bar(page).getByRole("button", { name: "Marchand" }).click();
	await page.getByRole("combobox", { name: "Rechercher un marchand" }).fill(merchant.name);
	await page.getByRole("option", { name: merchant.name }).click();
	await expect(toast(page, "Marchand modifié sur 2 opérations")).toBeVisible();

	await tick(page, labels);
	await page.keyboard.press("t");
	await page.getByRole("combobox", { name: "Rechercher une étiquette" }).fill(tag.name);
	await page.getByRole("option", { name: tag.name }).click();
	await page.keyboard.press("Escape");
	await expect(toast(page, "Étiquettes ajoutées sur 2 opérations")).toBeVisible();

	await tick(page, labels);
	await bar(page).getByRole("button", { name: "Exclure" }).click();
	await page.getByRole("menuitem", { name: "Exclure des rapports" }).click();
	await expect(toast(page, "2 opérations exclues des rapports")).toBeVisible();

	await page.reload();
	await Promise.all(
		labels.flatMap((label) => [
			expect(rowButton(page, label)).toContainText(merchant.name),
			expect(rowButton(page, label)).toContainText(tag.name),
			expect(rowButton(page, label)).toContainText("Exclue des rapports"),
		]),
	);
	await expect(rowButton(page, labelOf(prefix, 3))).not.toContainText(merchant.name);

	await tick(page, labels);
	await bar(page).getByRole("button", { name: "Exclure" }).click();
	await page.getByRole("menuitem", { name: "Réintégrer dans les rapports" }).click();
	await expect(toast(page, "2 opérations réintégrées dans les rapports")).toBeVisible();
	await Promise.all(
		labels.map((label) => expect(rowButton(page, label)).not.toContainText("Exclue des rapports")),
	);
});

test("« Tout sélectionner » categorises the 60 uncategorised rows of two pages", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Import");
	await withRows(api, prefix, 60);

	await visitOperations(page, prefix, "&category=none");
	await expect(page.getByText("60 résultats")).toBeVisible();

	// Another page is another selection.
	await checkbox(page, labelOf(prefix, 1)).click();
	await expect(bar(page)).toContainText("1 sélectionnée");
	await page.getByRole("link", { name: "Suivant" }).click();
	await expect(checkbox(page, labelOf(prefix, 51))).toBeVisible();
	await expect(bar(page)).toBeHidden();
	await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(0);
	await page.getByRole("link", { name: "Précédent" }).click();
	await expect(checkbox(page, labelOf(prefix, 1))).toBeVisible();
	await expect(checkbox(page, labelOf(prefix, 1))).not.toBeChecked();

	// Unticking one row of « all results » leaves the rest of the page ticked.
	await checkbox(page, labelOf(prefix, 1)).click();
	await bar(page).getByRole("button", { name: "Tout sélectionner (60 résultats)" }).click();
	await expect(bar(page)).toContainText("60 sélectionnées");
	await expect(checkbox(page, labelOf(prefix, 50))).toBeChecked();
	await checkbox(page, labelOf(prefix, 2)).click();
	await expect(bar(page)).toContainText("49 sélectionnées");
	await expect(checkbox(page, labelOf(prefix, 2))).not.toBeChecked();
	await expect(checkbox(page, labelOf(prefix, 1))).toBeChecked();
	await expect(checkbox(page, labelOf(prefix, 50))).toBeChecked();

	await bar(page).getByRole("button", { name: "Tout sélectionner (60 résultats)" }).click();
	await expect(bar(page)).toContainText("60 sélectionnées");
	await bar(page).getByRole("button", { name: "Catégorie" }).click();
	await page.keyboard.type("cour");
	await page.keyboard.press("Enter");

	await expect(toast(page, "Catégorie modifiée sur 60 opérations")).toBeVisible();
	await expect(page.getByText("Aucune opération ne correspond à ces filtres.")).toBeVisible();
});

test("Supprimer confirms with the count, focus on Annuler, and the balance follows", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Doublon");
	const account = await withRows(api, prefix);

	await visitOperations(page, prefix);
	await tick(page, [labelOf(prefix, 1), labelOf(prefix, 2)]);
	await bar(page).getByRole("button", { name: "Supprimer" }).click();
	const confirm = page.getByRole("alertdialog", { name: "Supprimer 2 opérations ?" });
	await expect(confirm.getByRole("button", { name: "Annuler" })).toBeFocused();
	await confirm.getByRole("button", { name: "Supprimer 2 opérations" }).click();

	await expect(confirm).toBeHidden();
	await expect(toast(page, "2 opérations supprimées")).toBeVisible();
	await expect(rowItem(page, labelOf(prefix, 1))).toHaveCount(0);
	await expect(rowItem(page, labelOf(prefix, 3))).toBeVisible();
	await expect(
		page.locator('[data-sidebar="sidebar"]').getByRole("link", { name: account.name }),
	).toContainText(euros(100_000 - 100));
});

test("a rejected bulk request keeps the rows and the selection, with a destructive toast", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Refus");
	await withRows(api, prefix);
	await page.route("**/api/transactions/bulk-update", (route) =>
		route.fulfill({
			status: 500,
			json: { error: { code: "INTERNAL_ERROR", message: "Something went wrong." } },
		}),
	);

	await visitOperations(page, prefix);
	await tick(page, [labelOf(prefix, 1), labelOf(prefix, 2)]);
	await bar(page).getByRole("button", { name: "Catégorie" }).click();
	await page.keyboard.type("cour");
	await page.keyboard.press("Enter");

	await expect(toast(page, "Une erreur inattendue s'est produite.")).toBeVisible();
	await expect(bar(page)).toContainText("2 sélectionnées");
	await expect(checkbox(page, labelOf(prefix, 1))).toBeChecked();
	await expect(
		rowItem(page, labelOf(prefix, 1)).getByRole("button", {
			name: "Catégorie : Sans catégorie",
		}),
	).toBeVisible();
});
