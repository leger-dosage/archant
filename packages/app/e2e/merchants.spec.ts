import type { Api } from "./fixtures.ts";
import type { Page } from "@playwright/test";

import { daysAgo, expect, test, uniqueName } from "./fixtures.ts";

// Stories 4.3, 11.12 and 32.3: merchant management under « Réglages ». One database serves the
// whole run, so each test works on merchants of its own.

const PAGE = "/settings/merchants";

const merchantRow = (page: Page, name: string) =>
	page.getByRole("button", { name: `Actions pour ${name}`, exact: true }).locator("..");

async function openAction(page: Page, name: string, action: "Modifier" | "Supprimer") {
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
	await page.goto(`/transactions?q=${encodeURIComponent(q)}`);
	await expect(rowButton(page, q)).toBeVisible();
}

test("editing a merchant renames it on its rows and keeps its colour and website", async ({
	page,
	api,
}) => {
	const label = uniqueName("CB CARREF");
	const merchant = await api.createMerchant(uniqueName("Carref"));
	const renamed = uniqueName("Carrefour");
	await linked(api, label, merchant.id);

	await page.goto(PAGE);
	await expect(page.getByRole("heading", { level: 1, name: "Marchands" })).toBeVisible();
	await expect(merchantRow(page, merchant.name)).toContainText("1 opération");
	await openAction(page, merchant.name, "Modifier");
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Nom").fill(renamed);
	await dialog
		.locator("label", { has: page.getByRole("radio", { name: "Vert", exact: true }) })
		.click();
	await dialog.getByPlaceholder("Site web (ex. : starbucks.com)").fill("carrefour.fr");
	await dialog.getByRole("button", { name: "Enregistrer" }).click();

	await expect(dialog).toBeHidden();
	await expect(merchantRow(page, renamed)).toBeVisible();
	await openAction(page, renamed, "Modifier");
	await expect(dialog.getByRole("radio", { name: "Vert", exact: true })).toBeChecked();
	await expect(dialog.getByLabel("Site web")).toHaveValue("carrefour.fr");
	await page.keyboard.press("Escape");
	await visitOperations(page, label);
	await expect(rowButton(page, label)).toContainText(renamed);
});

test("merging several merchants into another moves their rows and removes them", async ({
	page,
	api,
}) => {
	const label = uniqueName("CB LECLERC");
	const prefix = uniqueName("Leclerc");
	const source = await api.createMerchant(`${prefix} Drive`);
	const other = await api.createMerchant(`${prefix} Express`);
	const target = await api.createMerchant(prefix);
	await linked(api, label, source.id);

	await page.goto(PAGE);
	await page.getByRole("button", { name: "Plus d'actions sur les marchands" }).click();
	await page.getByRole("menuitem", { name: "Fusionner des marchands" }).click();
	const dialog = page.getByRole("dialog", { name: "Fusionner des marchands" });
	await dialog.getByRole("button", { name: "Fusionner vers (cible)" }).click();
	await page.getByRole("combobox", { name: "Rechercher un marchand" }).fill(target.name);
	await page.getByRole("option", { name: target.name, exact: true }).click();
	await dialog.getByRole("searchbox", { name: "Rechercher des marchands…" }).fill(prefix);
	// The target cannot be a source of its own merge.
	await expect(dialog.getByRole("checkbox", { name: target.name, exact: true })).toBeDisabled();
	await dialog.getByRole("checkbox", { name: source.name }).check();
	await dialog.getByRole("checkbox", { name: other.name }).check();
	await dialog.getByRole("button", { name: "Fusionner la sélection" }).click();

	await expect(dialog).toBeHidden();
	await expect(page.getByText("2 marchands fusionnés avec succès")).toBeVisible();
	await expect(merchantRow(page, source.name)).toHaveCount(0);
	await expect(merchantRow(page, other.name)).toHaveCount(0);
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

test("a merchant added from the header is listed with no transaction", async ({ page }) => {
	const name = uniqueName("Boulangerie");

	await page.goto(PAGE);
	// The section header's, or an empty list's own in its place.
	await page.getByRole("button", { name: "Ajouter un marchand", exact: true }).first().click();
	const dialog = page.getByRole("dialog", { name: "Ajouter un marchand" });
	await dialog.getByLabel("Nom").fill(name);
	await dialog.getByRole("button", { name: "Ajouter un marchand", exact: true }).click();

	await expect(dialog).toBeHidden();
	await expect(
		page.locator("[data-sonner-toast]").filter({ hasText: `Marchand « ${name} » ajouté.` }),
	).toBeVisible();
	await expect(merchantRow(page, name)).toContainText("0 opération");
	// Story 12.4: the row's letter icon, the name's first letter.
	await expect(merchantRow(page, name).locator('[data-slot="tinted-icon"]')).toHaveText(
		name.charAt(0).toLocaleUpperCase("fr"),
	);
});

test("a merchant name held in another case keeps the dialog open with the error under the field", async ({
	page,
	api,
}) => {
	const existing = await api.createMerchant(uniqueName("Boulangerie"));
	const upper = existing.name.toUpperCase();

	await page.goto(PAGE);
	await page.getByRole("button", { name: "Ajouter un marchand", exact: true }).first().click();
	const dialog = page.getByRole("dialog", { name: "Ajouter un marchand" });
	await dialog.getByLabel("Nom").fill(upper);
	await dialog.getByRole("button", { name: "Ajouter un marchand", exact: true }).click();

	await expect(dialog.getByText("Un marchand porte déjà ce nom.")).toBeVisible();
	await expect(dialog.getByLabel("Nom")).toHaveAttribute("aria-invalid", "true");
	await dialog.getByRole("button", { name: "Annuler" }).click();
	await expect(merchantRow(page, existing.name)).toBeVisible();
	await expect(merchantRow(page, upper)).toHaveCount(0);
});

test("an empty merchant list says so and offers the button that adds one", async ({ page }) => {
	// The shared database already holds other tests' merchants; the empty state
	// is what the API's empty list looks like.
	await page.route("**/api/merchants", (route) =>
		route.request().method() === "GET" ? route.fulfill({ json: { data: [] } }) : route.continue(),
	);

	await page.goto(PAGE);
	const empty = page.getByRole("heading", { name: "Aucun marchand pour l'instant" }).locator("..");
	await expect(empty).toBeVisible();
	await empty.getByRole("button", { name: "Ajouter un marchand", exact: true }).click();

	await expect(page.getByRole("dialog", { name: "Ajouter un marchand" })).toBeVisible();
});
