import type { Api } from "./fixtures.ts";
import type { Page } from "@playwright/test";

import { daysAgo, euros, expect, test, typed, uniqueName } from "./fixtures.ts";

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

const drawer = (page: Page) => page.getByRole("dialog", { name: "Modifier les opérations" });

/** Opens « Modifier » and picks the category whose name starts with `search`. */
async function pickCategory(page: Page, search: string) {
	await drawer(page).getByRole("button", { name: "Catégorie" }).click();
	await page.keyboard.type(search);
	await page.keyboard.press("Enter");
}

/** `<prefix> 01` (yesterday, listed first) to `<prefix> NN`. */
const labelOf = (prefix: string, day: number) => `${prefix} ${String(day).padStart(2, "0")}`;

/** An account holding `count` rows of -1,00, one a day, from 1 000,00. */
async function withRows(api: Api, prefix: string, count = 3) {
	const account = await api.openAccount({ openingDate: daysAgo(count + 10) });
	await api.addDailyTransactions(account.id, count, prefix);

	return account;
}

/** Opens `/transactions` on the rows labelled with `q`, and waits for them. */
async function visitOperations(page: Page, q: string, extra = "") {
	await page.goto(`/transactions?q=${encodeURIComponent(q)}${extra}`);
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

test("ticking two rows shows « 2 sélectionnées », over 36 px buttons", async ({ page, api }) => {
	const prefix = uniqueName("Tri");
	await withRows(api, prefix);

	await visitOperations(page, prefix);
	await tick(page, [labelOf(prefix, 1), labelOf(prefix, 3)]);

	await expect(bar(page)).toContainText("2 sélectionnées");
	await expect(checkbox(page, labelOf(prefix, 2))).not.toBeChecked();
	await Promise.all(
		["Modifier", "Supprimer"].flatMap((name) => {
			const button = bar(page).getByRole("button", { name, exact: true });

			return [
				expect(button).toHaveCSS("height", "36px"),
				expect(button).toHaveCSS("font-size", "14px"),
			];
		}),
	);
	await expect(
		bar(page).getByRole("button", { name: "Tout sélectionner (3 résultats)" }),
	).toHaveCSS("font-size", "14px");
});

test("Esc closing the bulk edit drawer keeps the selection", async ({ page, api }) => {
	const prefix = uniqueName("Fermer");
	await withRows(api, prefix);

	await visitOperations(page, prefix);
	await tick(page, [labelOf(prefix, 1), labelOf(prefix, 2)]);
	await bar(page).getByRole("button", { name: "Modifier" }).click();
	// Focus lands once the drawer listens for Escape.
	await expect(drawer(page).getByLabel("Date", { exact: true })).toBeFocused();
	await page.keyboard.press("Escape");

	await expect(drawer(page)).toBeHidden();
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

test("« Vider la sélection » unticks every row", async ({ page, api }) => {
	const prefix = uniqueName("Vider");
	await withRows(api, prefix);

	await visitOperations(page, prefix);
	await tick(page, [labelOf(prefix, 1), labelOf(prefix, 3)]);
	await expect(bar(page)).toContainText("2 sélectionnées");
	const clear = bar(page).getByRole("checkbox", { name: "Vider la sélection" });
	await expect(clear).toBeChecked();
	await clear.click();

	await expect(bar(page)).toBeHidden();
	await Promise.all(
		[1, 2, 3].map((day) => expect(checkbox(page, labelOf(prefix, day))).not.toBeChecked()),
	);
	await expect(rowButton(page, labelOf(prefix, 1))).toBeFocused();
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

test("a label and a tag saved in the drawer land on both ticked rows and clear the selection", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Voyage");
	const tag = await api.createTag(uniqueName("Vacances"));
	const renamed = uniqueName("Billet");
	await withRows(api, prefix);

	await visitOperations(page, prefix);
	await tick(page, [labelOf(prefix, 1), labelOf(prefix, 2)]);
	await bar(page).getByRole("button", { name: "Modifier" }).click();
	const sheet = drawer(page);
	await expect(sheet.getByRole("heading", { name: "Aperçu", exact: true })).toBeVisible();
	await expect(sheet.getByRole("heading", { name: "Opérations", exact: true })).toBeVisible();
	await sheet.getByLabel("Libellé").fill(renamed);
	await sheet.getByRole("button", { name: "Étiquettes" }).click();
	await page.getByRole("combobox", { name: "Rechercher une étiquette" }).fill(tag.name);
	await page.getByRole("option", { name: tag.name }).click();
	await page.keyboard.press("Escape");
	await expect(sheet.getByRole("button", { name: "Étiquettes" })).toContainText(tag.name);
	await sheet.getByRole("button", { name: "Enregistrer" }).click();

	await expect(toast(page, "2 opérations modifiées")).toBeVisible();
	await expect(sheet).toBeHidden();
	await expect(bar(page)).toBeHidden();
	await page.goto(`/transactions?q=${encodeURIComponent(renamed)}`);
	await expect(rowItem(page, renamed)).toHaveCount(2);
	await Promise.all(
		[0, 1].map((index) =>
			expect(
				rowItem(page, renamed).nth(index).locator("button[data-transaction-id]"),
			).toContainText(tag.name),
		),
	);
	await visitOperations(page, prefix);
	await expect(rowItem(page, labelOf(prefix, 3))).toBeVisible();
	await expect(rowButton(page, labelOf(prefix, 3))).not.toContainText(tag.name);
});

test("a date, notes and a merchant saved in the drawer move both rows, and the balance follows", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Date");
	const merchant = await api.createMerchant(uniqueName("SNCF"));
	const account = await withRows(api, prefix);
	// The opening date: its valuation sets that day's balance, as Sure's, so
	// the two rows moved onto it no longer count in the balance.
	const opening = daysAgo(13);
	const labels = [labelOf(prefix, 1), labelOf(prefix, 2)];

	await visitOperations(page, prefix);
	await tick(page, labels);
	await bar(page).getByRole("button", { name: "Modifier" }).click();
	const sheet = drawer(page);
	await sheet.getByLabel("Date", { exact: true }).fill(typed(opening));
	await sheet.getByLabel("Notes").fill("Remboursé");
	await sheet.getByRole("button", { name: "Marchand" }).click();
	await page.getByRole("combobox", { name: "Rechercher un marchand" }).fill(merchant.name);
	await page.getByRole("option", { name: merchant.name }).click();
	await expect(sheet.getByRole("button", { name: "Marchand" })).toContainText(merchant.name);
	await sheet.getByRole("button", { name: "Enregistrer" }).click();

	await expect(toast(page, "2 opérations modifiées")).toBeVisible();
	await expect(
		page
			.getByRole("complementary", { name: "Liste des comptes" })
			.getByRole("link", { name: account.name }),
	).toContainText(euros(100_000 - 100));
	await Promise.all(
		labels.map((label) => expect(rowButton(page, label)).toContainText(merchant.name)),
	);
	await rowButton(page, labels[0] ?? "").click();
	const row = page.getByRole("dialog", { name: "Modifier l'opération" });
	await expect(row.getByLabel("Date", { exact: true })).toHaveValue(typed(opening));
	await expect(row.getByLabel("Notes")).toHaveValue("Remboursé");
});

test("« Aucune étiquette » clears the tags, and a tag unticked again leaves them unchanged", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Effacer");
	const tag = await api.createTag(uniqueName("Vacances"));
	const other = await api.createTag(uniqueName("Travaux"));
	await withRows(api, prefix);
	const [first, second] = [labelOf(prefix, 1), labelOf(prefix, 2)];
	const tags = () => page.getByRole("combobox", { name: "Rechercher une étiquette" });

	await visitOperations(page, prefix);
	await tick(page, [first, second]);
	await bar(page).getByRole("button", { name: "Modifier" }).click();
	await drawer(page).getByRole("button", { name: "Étiquettes" }).click();
	await tags().fill(tag.name);
	await page.getByRole("option", { name: tag.name }).click();
	await page.keyboard.press("Escape");
	await drawer(page).getByRole("button", { name: "Enregistrer" }).click();
	await expect(toast(page, "2 opérations modifiées")).toBeVisible();
	await expect(rowButton(page, first)).toContainText(tag.name);

	// Ticked then unticked: the field reads « unchanged » again, and saving keeps the tag.
	await tick(page, [first]);
	await bar(page).getByRole("button", { name: "Modifier" }).click();
	const field = drawer(page).getByRole("button", { name: "Étiquettes" });
	await field.click();
	await tags().fill(other.name);
	await page.getByRole("option", { name: other.name }).click();
	await page.getByRole("option", { name: other.name }).click();
	await page.keyboard.press("Escape");
	await expect(field).toHaveText("Sélectionnez des étiquettes");
	await drawer(page).getByLabel("Notes").fill("Gardée");
	await drawer(page).getByRole("button", { name: "Enregistrer" }).click();
	await expect(toast(page, "1 opération modifiée")).toBeVisible();
	await expect(rowButton(page, first)).toContainText(tag.name);

	await tick(page, [first, second]);
	await bar(page).getByRole("button", { name: "Modifier" }).click();
	await field.click();
	await page.getByRole("option", { name: "Aucune étiquette" }).click();
	await page.keyboard.press("Escape");
	await expect(field).toHaveText("Aucune étiquette");
	await drawer(page).getByRole("button", { name: "Enregistrer" }).click();

	await expect(toast(page, "2 opérations modifiées")).toBeVisible();
	await expect(rowButton(page, first)).not.toContainText(tag.name);
	await expect(rowButton(page, second)).not.toContainText(tag.name);
});

test("« Enregistrer » with nothing filled closes the drawer without a request", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Vide");
	await withRows(api, prefix);
	let requests = 0;
	await page.route("**/api/transactions/bulk-update", async (route) => {
		requests += 1;
		await route.continue();
	});

	await visitOperations(page, prefix);
	await tick(page, [labelOf(prefix, 1), labelOf(prefix, 2)]);
	await bar(page).getByRole("button", { name: "Modifier" }).click();
	await drawer(page).getByRole("button", { name: "Enregistrer" }).click();

	await expect(drawer(page)).toBeHidden();
	await expect(bar(page)).toContainText("2 sélectionnées");
	expect(requests).toBe(0);
});

test("« Tout sélectionner » categorises the 60 uncategorised rows of two pages", async ({
	page,
	api,
}) => {
	const prefix = uniqueName("Import");
	await withRows(api, prefix, 60);

	await visitOperations(page, prefix, "&category=none");
	await expect(
		page.getByRole("group", { name: "Opérations", exact: true }).locator(".amount-summary"),
	).toHaveText("60");

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
	await bar(page).getByRole("button", { name: "Modifier" }).click();
	await pickCategory(page, "cour");
	await expect(drawer(page).getByRole("button", { name: "Catégorie" })).toContainText("Courses");
	await drawer(page).getByRole("button", { name: "Enregistrer" }).click();

	await expect(toast(page, "60 opérations modifiées")).toBeVisible();
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
		page
			.getByRole("complementary", { name: "Liste des comptes" })
			.getByRole("link", { name: account.name }),
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
	await bar(page).getByRole("button", { name: "Modifier" }).click();
	await pickCategory(page, "cour");
	await drawer(page).getByRole("button", { name: "Enregistrer" }).click();

	await expect(toast(page, "Une erreur inattendue s'est produite.")).toBeVisible();
	await drawer(page).getByRole("button", { name: "Annuler" }).click();
	await expect(drawer(page)).toBeHidden();
	await expect(bar(page)).toContainText("2 sélectionnées");
	await expect(checkbox(page, labelOf(prefix, 1))).toBeChecked();
	await expect(
		rowItem(page, labelOf(prefix, 1)).getByRole("button", {
			name: "Catégorie : Sans catégorie",
		}),
	).toBeVisible();
});
