import type { Page } from "@playwright/test";

import { daysAgo, euros, expect, test, typed, uniqueName } from "./fixtures.ts";

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

	await page.goto("/accounts");

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

	await page.goto("/accounts");
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

// Story 11.1: the opening balance is an end-of-day balance, so an opening
// dated today would refuse today's line.
test("an account created with the form's default opening date accepts a transaction dated today", async ({
	page,
}) => {
	const name = uniqueName("Livret");
	const label = uniqueName("Boulangerie");
	const [year, month, day] = daysAgo(0).split("-");
	const twoYearsAgo = `${Number(year) - 2}-${month}-${month === "02" && day === "29" ? "28" : day}`;

	await page.goto("/accounts");
	await page.getByRole("button", { name: "Ajouter un compte" }).click();
	const dialog = page.getByRole("dialog", { name: "Ajouter un compte" });
	await dialog.getByLabel("Nom").fill(name);
	await dialog.getByLabel("Solde initial").fill("1 000,00");
	await expect(dialog.getByLabel("Date du solde")).toHaveValue(typed(twoYearsAgo));
	await dialog.getByRole("button", { name: "Ajouter le compte" }).click();
	await expect(dialog).toBeHidden();

	await page
		.getByRole("main")
		.getByRole("link", { name: new RegExp(name) })
		.click();
	await page.getByRole("button", { name: "Ajouter une opération" }).first().click();
	const sheet = page.getByRole("dialog", { name: "Ajouter une opération" });
	await expect(sheet.getByLabel("Date", { exact: true })).toHaveValue(typed(daysAgo(0)));
	await sheet.getByLabel("Libellé").fill(label);
	await sheet.getByLabel("Montant").fill("42,90");
	await sheet.getByRole("button", { name: "Enregistrer" }).click();

	await expect(sheet).toBeHidden();
	await expect(
		page.getByRole("main").getByRole("button", { name: new RegExp(label) }),
	).toContainText(euros(-4290));
	await expect(page.getByRole("heading", { level: 1, name }).locator("..")).toContainText(
		euros(100_000 - 4290),
	);
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

	await page.goto("/accounts");

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

// Story 7.1: loan accounts.

test("a mortgage created through the form is listed under « Passifs », its page showing its details", async ({
	page,
}) => {
	const name = uniqueName("Prêt immobilier");

	await page.goto("/accounts");
	await page.getByRole("button", { name: "Ajouter un compte" }).click();
	const dialog = page.getByRole("dialog", { name: "Ajouter un compte" });
	await dialog.getByLabel("Nom").fill(name);
	await dialog.getByRole("combobox", { name: "Type" }).click();
	await page.getByRole("option", { name: "Prêt immobilier" }).click();
	await expect(dialog.getByLabel("Solde initial")).toHaveCount(0);
	await dialog.getByLabel("Capital restant dû").fill("180 000,00");
	await dialog.getByLabel("Montant emprunté").fill("200 000,00");
	await dialog.getByLabel("Taux (%)").fill("3,45");
	await dialog.getByLabel("Date de fin").fill("30/06/2045");
	await dialog.getByRole("button", { name: "Ajouter le compte" }).click();

	await expect(dialog).toBeHidden();
	const liabilities = page.getByRole("region", { name: "Passifs" });
	const row = liabilities.getByRole("link", { name: new RegExp(name) });
	await expect(row).toContainText("Prêt immobilier");
	await expect(row).toContainText(euros(18_000_000));
	await expect(
		page.getByRole("region", { name: "Actifs" }).getByRole("link", { name: new RegExp(name) }),
	).toHaveCount(0);

	await row.click();
	const details = page.getByRole("list", { name: "Détails du prêt" });
	await expect(details.getByRole("listitem")).toHaveText([
		`Emprunté : ${euros(20_000_000)}`,
		"Taux : 3,45 %",
		"Fin : 30/06/2045",
	]);
});

test("a loan's new rate in the edit dialog shows in its header", async ({ page, api }) => {
	const loan = await api.openAccount({
		name: uniqueName("Prêt"),
		kind: "consumer",
		openingBalance: "8 000,00",
		details: { interestRate: "4,9" },
	});

	await page.goto(`/accounts/${loan.id}`);
	const details = page.getByRole("list", { name: "Détails du prêt" });
	await expect(details).toHaveText("Taux : 4,90 %");
	await page.getByRole("button", { name: `Actions du compte ${loan.name}` }).click();
	await page.getByRole("menuitem", { name: "Modifier" }).click();
	const dialog = page.getByRole("dialog", { name: "Modifier le compte" });
	await expect(dialog.getByLabel("Taux (%)")).toHaveValue("4,90");
	await expect(dialog.getByLabel("Montant emprunté")).toHaveValue("");
	await dialog.getByLabel("Taux (%)").fill("3,456");
	await dialog.getByRole("button", { name: "Enregistrer" }).click();
	await expect(dialog.getByLabel("Taux (%)")).toHaveAccessibleDescription(
		"Taux invalide. Exemple : 3,45, entre 0 et 100.",
	);

	await dialog.getByLabel("Taux (%)").fill("3,75");
	await dialog.getByRole("button", { name: "Enregistrer" }).click();

	await expect(page.getByText(`Compte « ${loan.name} » enregistré.`)).toBeVisible();
	await expect(dialog).toBeHidden();
	await expect(details).toHaveText("Taux : 3,75 %");
	await page.reload();
	await expect(details).toHaveText("Taux : 3,75 %");
});

// Story 7.2: investment accounts.

test("a PEA created through the form is listed under « Actifs » with its value and caption, and in the sidebar", async ({
	page,
	api,
}) => {
	// A name without « PEA », so the caption alone can show it.
	const name = uniqueName("Plan actions");
	const before = await api.groupTotal("asset");

	await page.goto("/accounts");
	await page.getByRole("button", { name: "Ajouter un compte" }).click();
	const dialog = page.getByRole("dialog", { name: "Ajouter un compte" });
	await dialog.getByLabel("Nom").fill(name);
	await dialog.getByRole("combobox", { name: "Type" }).click();
	await page.getByRole("option", { name: "PEA", exact: true }).click();
	await expect(dialog.getByLabel("Montant emprunté")).toHaveCount(0);
	await dialog.getByLabel("Solde initial").fill("25 000,00");
	await dialog.getByRole("button", { name: "Ajouter le compte" }).click();

	await expect(dialog).toBeHidden();
	const row = page
		.getByRole("region", { name: "Actifs" })
		.getByRole("link", { name: new RegExp(name) });
	await expect(row.getByText("PEA", { exact: true })).toBeVisible();
	await expect(row).toContainText(euros(2_500_000));
	await expect(
		page.getByRole("region", { name: "Passifs" }).getByRole("link", { name: new RegExp(name) }),
	).toHaveCount(0);
	await expect(pageGroupHeader(page, "Actifs")).toContainText(euros(before + 2_500_000));

	// The toggle's parent is the sidebar group, which holds its account links.
	await expect(
		sidebarGroup(page, "Actifs")
			.locator("..")
			.getByRole("link", { name: new RegExp(name) }),
	).toContainText(euros(2_500_000));
	await expect(sidebarGroup(page, "Actifs")).toContainText(euros(before + 2_500_000));
});

// Story 7.3: property and vehicle accounts.

test("a home created through the form with its estimated value is listed under « Actifs » with its caption, and in the sidebar", async ({
	page,
	api,
}) => {
	// A name without « Maison », so the caption alone can show it.
	const name = uniqueName("Résidence principale");
	const before = await api.groupTotal("asset");

	await page.goto("/accounts");
	await page.getByRole("button", { name: "Ajouter un compte" }).click();
	const dialog = page.getByRole("dialog", { name: "Ajouter un compte" });
	await dialog.getByLabel("Nom").fill(name);
	await expect(dialog.getByLabel("Valeur estimée")).toHaveCount(0);
	await dialog.getByRole("combobox", { name: "Type" }).click();
	await page.getByRole("option", { name: "Maison", exact: true }).click();
	await expect(dialog.getByLabel("Solde initial")).toHaveCount(0);
	await dialog.getByLabel("Valeur estimée").fill("320 000,00");
	await dialog.getByLabel("Date du solde").fill(typed(daysAgo(10)));
	await dialog.getByRole("button", { name: "Ajouter le compte" }).click();

	await expect(dialog).toBeHidden();
	const row = page
		.getByRole("region", { name: "Actifs" })
		.getByRole("link", { name: new RegExp(name) });
	await expect(row.getByText("Maison", { exact: true })).toBeVisible();
	await expect(row).toContainText(euros(32_000_000));
	await expect(
		page.getByRole("region", { name: "Passifs" }).getByRole("link", { name: new RegExp(name) }),
	).toHaveCount(0);
	await expect(pageGroupHeader(page, "Actifs")).toContainText(euros(before + 32_000_000));

	await expect(
		sidebarGroup(page, "Actifs")
			.locator("..")
			.getByRole("link", { name: new RegExp(name) }),
	).toContainText(euros(32_000_000));
});

test("a vehicle created through the form with its estimated value is listed under « Actifs » with its caption", async ({
	page,
}) => {
	const name = uniqueName("Voiture");

	await page.goto("/accounts");
	await page.getByRole("button", { name: "Ajouter un compte" }).click();
	const dialog = page.getByRole("dialog", { name: "Ajouter un compte" });
	await dialog.getByLabel("Nom").fill(name);
	await dialog.getByRole("combobox", { name: "Type" }).click();
	await page.getByRole("option", { name: "Véhicule", exact: true }).click();
	await dialog.getByLabel("Valeur estimée").fill("18 500,00");
	await dialog.getByRole("button", { name: "Ajouter le compte" }).click();

	await expect(dialog).toBeHidden();
	const row = page
		.getByRole("region", { name: "Actifs" })
		.getByRole("link", { name: new RegExp(name) });
	await expect(row.getByText("Véhicule", { exact: true })).toBeVisible();
	await expect(row).toContainText(euros(1_850_000));
	await expect(
		page.getByRole("region", { name: "Passifs" }).getByRole("link", { name: new RegExp(name) }),
	).toHaveCount(0);
});

test("invalid fields show their message next to the field", async ({ page }) => {
	await page.goto("/accounts");
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

	await page.goto("/accounts");
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
	await page.goto("/accounts");
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
