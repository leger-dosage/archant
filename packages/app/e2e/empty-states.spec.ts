import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures.ts";

// Story 12.4: a page-level list with nothing in it shows DESIGN.md's empty
// state: a tinted icon, a heading, a sentence and the one button that fills
// it. Since Story 14.4 it is a card in the list's place, or, where the list
// has several groups, inside its group's white block. The shared database
// already holds other tests' rows, so each list is emptied as the API would
// answer it.

/** Answers `GET` on exactly `path` with an empty list; everything else reaches the server. */
async function emptyList(page: Page, path: string) {
	await page.route(`**${path}`, (route) =>
		route.request().method() === "GET" ? route.fulfill({ json: { data: [] } }) : route.fallback(),
	);
}

async function expectEmptyState(scope: Page | Locator, heading: string): Promise<Locator> {
	const empty = scope.locator('[data-slot="empty-state"]');

	await expect(empty.getByRole("heading", { name: heading, exact: true })).toBeVisible();
	await expect(empty.locator('[data-slot="tinted-icon"]')).toBeVisible();
	await expect(empty.getByRole("button")).toHaveCount(1);

	return empty;
}

test("rules: « Ajouter une règle » opens the form, the only one on the page", async ({ page }) => {
	await emptyList(page, "/api/rules");
	await page.goto("/rules");

	const empty = await expectEmptyState(page, "Aucune règle pour l'instant");
	await expect(empty.locator("svg.lucide-list-filter")).toBeVisible();
	await expect(page.getByRole("button", { name: "Ajouter une règle" })).toHaveCount(1);

	await empty.getByRole("button", { name: "Ajouter une règle" }).click();
	await expect(page.getByRole("dialog", { name: "Ajouter une règle" })).toBeVisible();
});

test("banks: « Choisir une banque » opens the bank picker, its search focused", async ({
	page,
}) => {
	await emptyList(page, "/api/bank-connections");
	await page.goto("/settings/banks");

	const connections = page.getByRole("region", { name: "Banques connectées" });
	const empty = await expectEmptyState(connections, "Aucune banque connectée pour l'instant");
	await expect(empty.locator("svg.lucide-landmark")).toBeVisible();

	await empty.getByRole("button", { name: "Choisir une banque" }).click();
	const picker = page.getByRole("dialog", { name: "Choisir une banque" });
	await expect(picker).toContainText("Pays : France.");
	await expect(picker.getByLabel("Rechercher une banque")).toBeFocused();
});

/** An empty kind's state, then its button, which opens the form on `kind`. */
async function addFromEmptyKind(page: Page, group: string, heading: string, kind: string) {
	const empty = await expectEmptyState(
		page.getByRole("region", { name: group, exact: true }),
		heading,
	);

	await empty.getByRole("button", { name: "Ajouter une catégorie" }).click();
	const dialog = page.getByRole("dialog", { name: "Ajouter une catégorie" });
	await expect(dialog.getByRole("combobox", { name: "Type" })).toHaveText(kind);
	await dialog.getByRole("button", { name: "Annuler" }).click();
	await expect(dialog).toBeHidden();
}

test("categories: an empty kind's button opens the form on that kind", async ({ page }) => {
	await emptyList(page, "/api/categories");
	await page.goto("/settings/categories");

	await addFromEmptyKind(page, "Revenus", "Aucune catégorie de revenus", "Revenu");
	await addFromEmptyKind(page, "Dépenses", "Aucune catégorie de dépenses", "Dépense");
});

test("merchants: « Ajouter un marchand » opens the form", async ({ page }) => {
	await emptyList(page, "/api/merchants");
	await page.goto("/settings/merchants");

	const empty = await expectEmptyState(page, "Aucun marchand pour l'instant");
	await expect(empty.locator("svg.lucide-store")).toBeVisible();
	await expect(page.getByRole("button", { name: "Ajouter un marchand" })).toHaveCount(1);

	await empty.getByRole("button", { name: "Ajouter un marchand" }).click();
	await expect(page.getByRole("dialog", { name: "Ajouter un marchand" })).toBeVisible();
});

test("tags: « Ajouter une étiquette » opens the form", async ({ page }) => {
	await emptyList(page, "/api/tags");
	await page.goto("/settings/tags");

	const empty = await expectEmptyState(page, "Aucune étiquette pour l'instant");
	await expect(empty.locator("svg.lucide-tag")).toBeVisible();
	await expect(page.getByRole("button", { name: "Ajouter une étiquette" })).toHaveCount(1);

	await empty.getByRole("button", { name: "Ajouter une étiquette" }).click();
	await expect(page.getByRole("dialog", { name: "Ajouter une étiquette" })).toBeVisible();
});
