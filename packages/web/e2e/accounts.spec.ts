import type { Page } from "@playwright/test";

import { euros, expect, test, uniqueName } from "./fixtures.ts";

// Story 1.1: create an account and see it listed.

/** The total printed beside a group's heading on the accounts page. */
const pageGroupHeader = (page: Page, group: "Actifs" | "Passifs") =>
	page.getByRole("heading", { level: 2, name: group }).locator("..");

/** The sidebar's group toggle, which carries the group's total. */
const sidebarGroup = (page: Page, group: "Actifs" | "Passifs") =>
	page.getByRole("button", { name: new RegExp(`^${group}`) });

test("an empty household sees the empty state and a button to add an account", async ({ page }) => {
	// The shared database already holds other tests' accounts; the empty state
	// is what the API's empty list looks like.
	await page.route("**/api/accounts", (route) =>
		route.fulfill({
			json: {
				data: {
					reportingCurrency: "EUR",
					groups: [
						{ classification: "asset", accounts: [], total: 0, excludedCount: 0 },
						{ classification: "liability", accounts: [], total: 0, excludedCount: 0 },
					],
				},
			},
		}),
	);

	await page.goto("/comptes");

	await expect(page.getByRole("heading", { level: 1, name: "Comptes" })).toBeVisible();
	await expect(page.getByText("Aucun compte pour l'instant.")).toBeVisible();
	await expect(page.getByRole("button", { name: "Ajouter un compte" })).toBeVisible();
});

test("an account created through the form is listed under its group, in the sidebar too", async ({
	page,
	api,
}) => {
	const name = uniqueName("Courant");
	const before = await api.groupTotal("asset");

	await page.goto("/comptes");
	await page.getByRole("button", { name: "Ajouter un compte" }).click();

	const dialog = page.getByRole("dialog", { name: "Ajouter un compte" });
	await dialog.getByLabel("Nom").fill(name);
	await expect(dialog.getByRole("combobox", { name: "Type" })).toHaveText("Compte courant");
	await expect(dialog.getByRole("combobox", { name: "Devise" })).toHaveText("EUR");
	await dialog.getByLabel("Solde initial").fill("1 234,56");
	await dialog.getByRole("button", { name: "Ajouter le compte" }).click();

	await expect(dialog).toBeHidden();
	await expect(page.getByText(`Compte « ${name} » ajouté.`)).toBeVisible();

	const assets = page.getByRole("region", { name: "Actifs" });
	const row = assets.getByRole("link", { name: new RegExp(name) });
	await expect(row).toContainText("Compte courant");
	await expect(row).toContainText("1 234,56 €");
	await expect(pageGroupHeader(page, "Actifs")).toContainText(euros(before + 123_456));

	// The sidebar has no landmark of its own: its link is the one outside the page's main.
	const links = page.getByRole("link", { name: new RegExp(name) });
	await expect(links).toHaveCount(2);
	await expect(page.getByRole("main").getByRole("link", { name: new RegExp(name) })).toHaveCount(1);
	await expect(links.nth(0)).toContainText("1 234,56 €");
	await expect(links.nth(1)).toContainText("1 234,56 €");
	await expect(sidebarGroup(page, "Actifs")).toContainText(euros(before + 123_456));
});

test("a depository account is listed under assets and a credit card under liabilities", async ({
	page,
	api,
}) => {
	const savings = await api.openAccount({ name: uniqueName("Livret"), kind: "savings" });
	const card = await api.openAccount({
		name: uniqueName("Carte"),
		kind: "credit_card",
		openingBalance: "250,00",
	});
	const assetTotal = await api.groupTotal("asset");
	const liabilityTotal = await api.groupTotal("liability");

	await page.goto("/comptes");

	const assets = page.getByRole("region", { name: "Actifs" });
	const liabilities = page.getByRole("region", { name: "Passifs" });

	await expect(assets.getByRole("link", { name: new RegExp(savings.name) })).toContainText(
		"Épargne",
	);
	await expect(liabilities.getByRole("link", { name: new RegExp(card.name) })).toContainText(
		"250,00 €",
	);
	await expect(assets.getByRole("link", { name: new RegExp(card.name) })).toHaveCount(0);
	await expect(liabilities.getByRole("link", { name: new RegExp(savings.name) })).toHaveCount(0);

	await expect(pageGroupHeader(page, "Actifs")).toContainText(euros(assetTotal));
	await expect(pageGroupHeader(page, "Passifs")).toContainText(euros(liabilityTotal));
});

test("invalid fields show their message next to the field", async ({ page }) => {
	await page.goto("/comptes");
	await page.getByRole("button", { name: "Ajouter un compte" }).click();

	const dialog = page.getByRole("dialog", { name: "Ajouter un compte" });
	await dialog.getByLabel("Solde initial").fill("douze");
	await dialog.getByRole("button", { name: "Ajouter le compte" }).click();

	await expect(dialog.getByLabel("Nom")).toHaveAccessibleDescription("Ce champ est obligatoire.");
	await expect(dialog.getByLabel("Solde initial")).toHaveAccessibleDescription(
		"Montant invalide. Exemple : 1 234,56.",
	);
	await expect(dialog).toBeVisible();
});

test("a field error from the API is shown next to its field", async ({ page }) => {
	// The form's own check shares the API's schema, so it never lets an
	// unknown currency through: only a refusal from the API shows this path.
	await page.route("**/api/accounts", async (route) => {
		if (route.request().method() !== "POST") {
			return route.fallback();
		}

		return route.fulfill({
			status: 400,
			json: {
				error: {
					code: "VALIDATION_ERROR",
					message: "Invalid request",
					fields: [{ path: "currency", code: "invalid_currency" }],
				},
			},
		});
	});

	await page.goto("/comptes");
	await page.getByRole("button", { name: "Ajouter un compte" }).click();

	const dialog = page.getByRole("dialog", { name: "Ajouter un compte" });
	await dialog.getByLabel("Nom").fill(uniqueName("Refusé"));
	await dialog.getByLabel("Solde initial").fill("10");
	await dialog.getByRole("button", { name: "Ajouter le compte" }).click();

	await expect(dialog.getByRole("combobox", { name: "Devise" })).toHaveAccessibleDescription(
		"Devise inconnue.",
	);
});

test("the theme switches between light and dark and is remembered", async ({ page }) => {
	await page.emulateMedia({ colorScheme: "light" });
	await page.goto("/comptes");
	const root = page.locator("html");

	await expect(root).not.toHaveClass(/dark/u);

	await page.getByRole("button", { name: "Thème : Système" }).click();
	await page.getByRole("menuitemradio", { name: "Sombre" }).click();
	await expect(root).toHaveClass(/dark/u);

	await page.reload();
	await expect(root).toHaveClass(/dark/u);

	await page.getByRole("button", { name: "Thème : Sombre" }).click();
	await page.getByRole("menuitemradio", { name: "Clair" }).click();
	await expect(root).not.toHaveClass(/dark/u);
});
