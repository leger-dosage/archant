import type { Locator, Page } from "@playwright/test";

import { z } from "zod";

import { daysAgo, euros, expect, rgb, test, typed, uniqueName } from "./fixtures.ts";

// Story 1.1: create an account and see it listed.

/** The total printed beside a group's heading on the accounts page. */
const pageGroupHeader = (page: Page, group: "Actifs" | "Passifs") =>
	page.getByRole("heading", { level: 2, name: group }).locator("..");

/** The accounts column, beside every page but settings. */
const column = (page: Page) => page.getByRole("complementary", { name: "Liste des comptes" });

/** The page's own « Ajouter un compte »: the accounts column holds another. */
const addAccount = (page: Page) =>
	page.getByRole("main").getByRole("button", { name: "Ajouter un compte" });

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
	// Story 14.4: DESIGN.md's empty state, a card of its own.
	const empty = page.locator('[data-slot="empty-state"]');
	await expect(empty.getByRole("heading", { name: "Aucun compte pour l'instant" })).toBeVisible();
	await expect(empty.locator('[data-slot="tinted-icon"] svg.lucide-landmark')).toBeVisible();
	await expect(empty.getByRole("button", { name: "Ajouter un compte" })).toBeVisible();
	await expect(addAccount(page)).toBeVisible();
});

test("an account created through the form is listed under its group, in the accounts column too", async ({
	page,
	api,
}) => {
	const name = uniqueName("Courant");
	const before = await api.groupTotal("asset");

	await page.goto("/accounts");
	await addAccount(page).click();

	const dialog = page.getByRole("dialog", { name: "Ajouter un compte" });
	await dialog.getByLabel("Nom").fill(name);
	await expect(dialog.getByRole("combobox", { name: "Type" })).toHaveText("Compte courant");
	await expect(dialog.getByRole("combobox", { name: "Devise" })).toHaveText("EUR");
	await dialog.getByLabel("Solde à la date :").fill("1 234,56");
	await dialog.getByRole("button", { name: "Ajouter le compte" }).click();

	await expect(dialog).toBeHidden();
	await expect(page.getByText(`Compte « ${name} » ajouté.`)).toBeVisible();

	const assets = page.getByRole("region", { name: "Actifs" });
	const row = assets.getByRole("link", { name: new RegExp(name) });
	await expect(row).toContainText("Compte courant");
	await expect(row).toContainText("1 234,56 €");
	await expect(pageGroupHeader(page, "Actifs")).toContainText(euros(before + 123_456));

	await expect(page.getByRole("link", { name: new RegExp(name) })).toHaveCount(2);
	await expect(page.getByRole("main").getByRole("link", { name: new RegExp(name) })).toHaveCount(1);
	const inColumn = column(page)
		.getByRole("group", { name: "Comptes bancaires" })
		.getByRole("link", { name: new RegExp(name) });
	await expect(inColumn).toContainText("Compte courant");
	await expect(inColumn).toContainText("1 234,56 €");
});

// Story 28.1: Sure's depository subtypes, « Espèces » among them.
test("a cash account created through the form is listed as « Espèces »", async ({ page }) => {
	const name = uniqueName("Tirelire");

	await page.goto("/accounts");
	await addAccount(page).click();

	const dialog = page.getByRole("dialog", { name: "Ajouter un compte" });
	await dialog.getByLabel("Nom").fill(name);
	await dialog.getByRole("combobox", { name: "Type" }).click();
	await expect(page.getByRole("option").first()).toHaveText("Liquidités");
	await page.getByRole("option", { name: "Espèces" }).click();
	await dialog.getByLabel("Solde à la date :").fill("80,00");
	await dialog.getByRole("button", { name: "Ajouter le compte" }).click();
	await expect(dialog).toBeHidden();

	const row = page
		.getByRole("region", { name: "Actifs" })
		.getByRole("link", { name: new RegExp(name) });
	await expect(row).toContainText("Espèces");
	await expect(row).toContainText("80,00 €");
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
	await addAccount(page).click();
	const dialog = page.getByRole("dialog", { name: "Ajouter un compte" });
	await dialog.getByLabel("Nom").fill(name);
	await dialog.getByLabel("Solde à la date :").fill("1 000,00");
	await expect(dialog.getByLabel("Date du solde d'ouverture")).toHaveValue(typed(twoYearsAgo));
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
	await expect(page.getByRole("region", { name, exact: true })).toContainText(
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

// Story 14.2: the note under « Actifs » sits in its tray, between the header and the rows.
test("a group with an account in another currency says so in its tray", async ({ page }) => {
	await page.route("**/api/accounts", (route) =>
		route.fulfill({
			json: {
				data: {
					reportingCurrency: "EUR",
					groups: [
						{
							classification: "asset",
							total: 100_000,
							excludedCount: 1,
							accounts: [
								{
									id: "a1",
									name: "Compte joint",
									type: "depository",
									subtype: "checking",
									currency: "EUR",
									balance: 100_000,
									active: true,
									excludedFromReports: false,
								},
								{
									id: "a2",
									name: "Compte USD",
									type: "depository",
									subtype: "checking",
									currency: "USD",
									balance: 50_000,
									active: true,
									excludedFromReports: false,
								},
							],
						},
						{ classification: "liability", accounts: [], total: 0, excludedCount: 0 },
					],
				},
			},
		}),
	);

	await page.goto("/accounts");

	await expect(
		page
			.getByRole("region", { name: "Actifs" })
			.getByText("1 compte dans une autre devise n'est pas compté dans le total."),
	).toBeVisible();
});

// Story 12.3: sections with the accounts' type icons, and the type icon in an
// account's page header.
test("each group is a section whose accounts carry their type icon, as the account's page header does", async ({
	page,
	api,
}) => {
	const savings = await api.openAccount({ name: uniqueName("Livret"), kind: "savings" });
	const card = await api.openAccount({ name: uniqueName("Carte"), kind: "credit_card" });

	await page.goto("/accounts");

	const assets = page.getByRole("region", { name: "Actifs" });
	const liabilities = page.getByRole("region", { name: "Passifs" });
	// Story 14.2: each group is a grey tray under an uppercase header.
	await expect(assets).toHaveCSS("background-color", rgb("#f2f2f3"));
	await expect(liabilities).toHaveCSS("background-color", rgb("#f2f2f3"));
	await expect(assets).toHaveCSS("border-radius", "12px");
	await expect(assets.getByRole("heading", { level: 2, name: "Actifs" })).toHaveCSS(
		"text-transform",
		"uppercase",
	);
	await expect(
		assets
			.getByRole("link", { name: new RegExp(savings.name) })
			.locator('[data-slot="tinted-icon"]'),
	).toHaveCSS("width", "36px");
	await expect(
		assets
			.getByRole("link", { name: new RegExp(savings.name) })
			.locator('[data-slot="tinted-icon"] svg.lucide-landmark'),
	).toBeVisible();
	await expect(
		liabilities
			.getByRole("link", { name: new RegExp(card.name) })
			.locator('[data-slot="tinted-icon"] svg.lucide-credit-card'),
	).toBeVisible();

	await liabilities.getByRole("link", { name: new RegExp(card.name) }).click();

	const header = page.getByRole("heading", { level: 1, name: card.name }).locator("..");
	await expect(header.locator('[data-slot="tinted-icon"] svg.lucide-credit-card')).toBeVisible();
	await expect(header.locator('[data-slot="tinted-icon"]')).toHaveCSS("width", "36px");
	await expect(
		header.getByRole("button", { name: `Actions du compte ${card.name}` }),
	).toBeVisible();
});

// Story 7.1: loan accounts, with Story 24.1's terms.

test("the owner's ING mortgage created through the form is listed under « Passifs », its overview naming its terms", async ({
	page,
}) => {
	const name = uniqueName("Crédit ING");

	await page.goto("/accounts");
	await addAccount(page).click();
	const dialog = page.getByRole("dialog", { name: "Ajouter un compte" });
	await dialog.getByLabel("Nom").fill(name);
	await dialog.getByRole("combobox", { name: "Type", exact: true }).click();
	await page.getByRole("option", { name: "Prêt immobilier" }).click();
	// Sure's one label for every type, a loan's included.
	await dialog.getByLabel("Solde à la date :").fill("104 724,54");
	// Sure's order: the amount, the rate and its type, the down payment, the start, the term, the insurance.
	const fieldIds = await dialog
		.locator("[id^='loan-']:is(input, button)")
		.evaluateAll((fields) => fields.map((field) => field.id));
	expect(fieldIds).toEqual([
		"loan-originalAmount",
		"loan-interestRate",
		"loan-rateType",
		"loan-downPayment",
		"loan-startDate",
		"loan-termMonths",
		"loan-insuranceRate",
		"loan-insuranceRateType",
	]);
	await dialog.getByLabel("Solde initial du prêt").fill("130 000,00");
	await dialog.getByLabel("Apport personnel").fill("0");
	await expect(dialog.getByLabel("Date d'origine")).toHaveAccessibleDescription(
		"Date à laquelle le prêt a été débloqué. Laissez vide pour prendre la date d'ouverture du compte.",
	);
	await dialog.getByLabel("Date d'origine").fill("05/12/2020");
	await expect(dialog.getByLabel("Durée (mois)")).toHaveAttribute("placeholder", "360");
	// The API saves a term of 0, as Sure's model; the dialog refuses it, as Sure's form.
	await dialog.getByLabel("Durée (mois)").fill("0");
	await dialog.getByRole("button", { name: "Ajouter le compte" }).click();
	await expect(dialog.getByLabel("Durée (mois)")).toHaveAccessibleDescription(
		"Durée invalide : un nombre entier de mois, de 1 à 1 200.",
	);
	await expect(dialog).toBeVisible();
	await dialog.getByLabel("Durée (mois)").fill("300");
	await expect(dialog.getByLabel("Taux d'intérêt")).toHaveAttribute("placeholder", "5,25");
	await dialog.getByLabel("Taux d'intérêt").fill("1,82");
	// A typed rate is fixed until said otherwise.
	await expect(dialog.getByRole("combobox", { name: "Type de taux" })).toHaveText("Fixe");
	await expect(dialog.getByRole("group", { name: "Changements de taux" })).toHaveCount(0);
	await dialog.getByLabel("Taux d'assurance").fill("0,2917");
	await expect(dialog.getByRole("combobox", { name: "Type d'assurance" })).toHaveText("Aucun");
	await expect(
		dialog.getByRole("combobox", { name: "Type d'assurance" }),
	).toHaveAccessibleDescription(
		"Un taux annuel, prélevé chaque mois en complément de la mensualité. L'assurance constante porte sur le capital initial, l'assurance dégressive sur le capital restant dû.",
	);
	await dialog.getByRole("combobox", { name: "Type d'assurance" }).click();
	await expect(page.getByRole("option")).toHaveText(["Aucun", "Constante", "Dégressive"]);
	await page.getByRole("option", { name: "Constante" }).click();
	await dialog.getByRole("button", { name: "Ajouter le compte" }).click();

	await expect(dialog).toBeHidden();
	const liabilities = page.getByRole("region", { name: "Passifs" });
	const row = liabilities.getByRole("link", { name: new RegExp(name) });
	await expect(row).toContainText("Prêt immobilier");
	await expect(row).toContainText(euros(10_472_454));
	await expect(
		page.getByRole("region", { name: "Actifs" }).getByRole("link", { name: new RegExp(name) }),
	).toHaveCount(0);

	await row.click();
	// As Sure's account page, the terms show in « Aperçu », not under the name.
	await page.getByRole("tab", { name: "Aperçu" }).click();
	const overview = page.getByRole("tabpanel", { name: "Aperçu" });
	const card = (title: string) => overview.getByRole("group", { name: title, exact: true });
	await expect(card("Capital d'origine")).toContainText(euros(13_000_000));
	await expect(card("Taux d'intérêt")).toContainText("1,820 %");
	await expect(card("Type")).toContainText("Fixe");
	await expect(card("Durée")).toContainText("25 ans");

	// What the overview does not name still reached the server.
	await page.getByRole("button", { name: `Actions du compte ${name}` }).click();
	await page.getByRole("menuitem", { name: "Modifier" }).click();
	const edit = page.getByRole("dialog", { name: "Modifier le compte" });
	await expect(edit.getByLabel("Apport personnel")).toHaveValue("0,00");
	await expect(edit.getByLabel("Date d'origine")).toHaveValue("05/12/2020");
	await expect(edit.getByLabel("Taux d'assurance")).toHaveValue("0,2917");
	await expect(edit.getByRole("combobox", { name: "Type d'assurance" })).toHaveText("Constante");
});

// Story 28.11: Sure's `cryptos/_form`, its subtype and tax treatment in both dialogs.
test("a crypto account's tax treatment and subtype typed at creation read back in its edit dialog, and change there", async ({
	page,
}) => {
	const name = uniqueName("Crypto");

	await page.goto("/accounts");
	await addAccount(page).click();
	const dialog = page.getByRole("dialog", { name: "Ajouter un compte" });
	await dialog.getByLabel("Nom").fill(name);
	await dialog.getByRole("combobox", { name: "Type" }).click();
	await page.getByRole("option", { name: "Plateforme d'échange crypto" }).click();
	await dialog.getByRole("combobox", { name: "Traitement fiscal" }).click();
	await page.getByRole("option", { name: "Exonéré d'impôt" }).click();
	await dialog.getByLabel("Solde à la date :").fill("1 000,00");
	await dialog.getByRole("button", { name: "Ajouter le compte" }).click();
	await expect(dialog).toBeHidden();

	await page
		.getByRole("region", { name: "Actifs" })
		.getByRole("link", { name: new RegExp(name) })
		.click();
	const openEdit = async () => {
		await page.getByRole("button", { name: `Actions du compte ${name}` }).click();
		await page.getByRole("menuitem", { name: "Modifier" }).click();

		return page.getByRole("dialog", { name: "Modifier le compte" });
	};
	const edit = await openEdit();
	await expect(edit.getByRole("combobox", { name: "Type" })).toHaveText(
		"Plateforme d'échange crypto",
	);
	await expect(edit.getByRole("combobox", { name: "Traitement fiscal" })).toHaveText(
		"Exonéré d'impôt",
	);
	await edit.getByRole("combobox", { name: "Traitement fiscal" }).click();
	await page.getByRole("option", { name: "Imposition différée" }).click();
	await edit.getByRole("combobox", { name: "Type" }).click();
	await page.getByRole("option", { name: "Portefeuille crypto" }).click();
	await edit.getByRole("button", { name: "Enregistrer" }).click();
	await expect(edit).toBeHidden();

	const again = await openEdit();
	await expect(again.getByRole("combobox", { name: "Type" })).toHaveText("Portefeuille crypto");
	await expect(again.getByRole("combobox", { name: "Traitement fiscal" })).toHaveText(
		"Imposition différée",
	);
});

// Story 28.2: Sure's `credit_cards/_form`, its fields in its order and rows.
test("a card's details typed at creation read back in its edit dialog, with no toggle unlinked", async ({
	page,
}) => {
	const name = uniqueName("Visa");

	await page.goto("/accounts");
	await addAccount(page).click();
	const dialog = page.getByRole("dialog", { name: "Ajouter un compte" });
	await dialog.getByLabel("Nom").fill(name);
	await dialog.getByRole("combobox", { name: "Type" }).click();
	await page.getByRole("option", { name: "Carte de crédit" }).click();
	await dialog.getByLabel("Solde à la date :").fill("450,00");
	const fieldIds = await dialog
		.locator("[id^='card-']:is(input, button)")
		.evaluateAll((fields) => fields.map((field) => field.id));
	expect(fieldIds).toEqual([
		"card-availableCredit",
		"card-minimumPayment",
		"card-apr",
		"card-expirationDate",
		"card-annualFee",
	]);
	await expect(dialog.getByLabel("Crédit disponible")).toHaveAttribute("placeholder", "10000");
	await expect(dialog.getByLabel("Paiement minimum")).toHaveAttribute("placeholder", "100");
	await expect(dialog.getByLabel("TAEG")).toHaveAttribute("placeholder", "15,99");
	await expect(dialog.getByLabel("Frais annuels")).toHaveAttribute("placeholder", "99");
	await dialog.getByLabel("Crédit disponible").fill("3 000");
	await dialog.getByLabel("Paiement minimum").fill("25,50");
	await dialog.getByLabel("TAEG").fill("1,234");
	await dialog.getByLabel("Date d'expiration").fill("30/04/2028");
	await dialog.getByRole("button", { name: "Ajouter le compte" }).click();
	await expect(
		dialog.getByText("Taux invalide : un nombre positif ou nul, deux décimales au plus."),
	).toBeVisible();
	await dialog.getByLabel("TAEG").fill("15,99");
	await dialog.getByRole("button", { name: "Ajouter le compte" }).click();
	await expect(dialog).toBeHidden();

	await page
		.getByRole("region", { name: "Passifs" })
		.getByRole("link", { name: new RegExp(name) })
		.click();
	await page.getByRole("button", { name: `Actions du compte ${name}` }).click();
	await page.getByRole("menuitem", { name: "Modifier" }).click();
	const edit = page.getByRole("dialog", { name: "Modifier le compte" });
	await expect(edit.getByLabel("Crédit disponible")).toHaveValue("3000,00");
	await expect(edit.getByLabel("Paiement minimum")).toHaveValue("25,50");
	await expect(edit.getByLabel("TAEG")).toHaveValue("15,99");
	await expect(edit.getByLabel("Date d'expiration")).toHaveValue("30/04/2028");
	await expect(edit.getByLabel("Frais annuels")).toHaveValue("");
	await expect(edit.getByLabel("Le solde correspond au crédit disponible")).toHaveCount(0);

	await edit.getByLabel("Frais annuels").fill("99");
	await edit.getByLabel("Crédit disponible").fill("");
	await edit.getByRole("button", { name: "Enregistrer" }).click();
	await expect(edit).toBeHidden();
	await page.reload();
	await page.getByRole("button", { name: `Actions du compte ${name}` }).click();
	await page.getByRole("menuitem", { name: "Modifier" }).click();
	await expect(edit.getByLabel("Frais annuels")).toHaveValue("99,00");
	await expect(edit.getByLabel("Crédit disponible")).toHaveValue("");
});

test("a loan's rate and term edited in the dialog show in its overview", async ({ page, api }) => {
	const loan = await api.openAccount({
		name: uniqueName("Prêt"),
		kind: "auto",
		openingBalance: "8 000,00",
		details: { interestRate: "4,9", termMonths: "30" },
	});

	await page.goto(`/accounts/${loan.id}?tab=overview`);
	const overview = page.getByRole("tabpanel", { name: "Aperçu" });
	const card = (name: string) => overview.getByRole("group", { name, exact: true });
	await expect(card("Taux d'intérêt")).toContainText("4,900 %");
	await expect(card("Type")).toContainText("Inconnu");
	await expect(card("Durée")).toContainText("2 ans");
	await page.getByRole("button", { name: `Actions du compte ${loan.name}` }).click();
	await page.getByRole("menuitem", { name: "Modifier" }).click();
	const dialog = page.getByRole("dialog", { name: "Modifier le compte" });
	const rate = dialog.getByLabel("Taux d'intérêt");
	await expect(rate).toHaveValue("4,90");
	await expect(dialog.getByLabel("Solde initial du prêt")).toHaveValue("");
	await rate.fill("1,8205");
	// The API saves a term of 0, as Sure's model; the dialog refuses it, as Sure's form.
	await dialog.getByLabel("Durée (mois)").fill("0");
	await dialog.getByRole("button", { name: "Enregistrer" }).click();
	await expect(rate).toHaveAccessibleDescription(
		"Taux invalide : un nombre positif, trois décimales au plus, quatre pour l'assurance.",
	);
	await expect(dialog.getByLabel("Durée (mois)")).toHaveAccessibleDescription(
		"Durée invalide : un nombre entier de mois, de 1 à 1 200.",
	);

	// Sure caps neither rate.
	await rate.fill("150");
	await dialog.getByLabel("Durée (mois)").fill("48");
	await dialog.getByRole("button", { name: "Enregistrer" }).click();

	await expect(page.getByText(`Compte « ${loan.name} » enregistré.`)).toBeVisible();
	await expect(dialog).toBeHidden();
	// A rate typed without a rate type is fixed, as Sure's default.
	await expect(card("Taux d'intérêt")).toContainText("150,000 %");
	await expect(card("Type")).toContainText("Fixe");
	await expect(card("Durée")).toContainText("4 ans");
	await page.reload();
	await expect(card("Type")).toContainText("Fixe");
	await expect(card("Durée")).toContainText("4 ans");
});

test("a variable loan's rate changes are added, refused before origination, and kept hidden once fixed", async ({
	page,
	api,
}) => {
	const loan = await api.openAccount({
		name: uniqueName("Prêt"),
		kind: "mortgage",
		openingBalance: "100 000,00",
		openingDate: "2022-01-01",
		details: {
			startDate: "2020-12-05",
			rateType: "variable",
			interestRate: "1,5",
			rateChanges: [{ effectiveDate: "2023-06-05", rate: "2" }],
		},
	});

	await page.goto(`/accounts/${loan.id}?tab=overview`);
	const type = page
		.getByRole("tabpanel", { name: "Aperçu" })
		.getByRole("group", { name: "Type", exact: true });
	await expect(type).toContainText("Variable");
	await page.getByRole("button", { name: `Actions du compte ${loan.name}` }).click();
	await page.getByRole("menuitem", { name: "Modifier" }).click();
	const dialog = page.getByRole("dialog", { name: "Modifier le compte" });
	const changes = dialog.getByRole("group", { name: "Changements de taux" });
	// Sure's disclosure opens closed.
	await expect(changes).toBeHidden();
	await dialog.getByText("Changements de taux", { exact: true }).click();
	await expect(changes).toHaveAccessibleDescription(
		"Chaque ligne fixe le taux appliqué de sa date d'effet jusqu'à la suivante. Saisir à nouveau une date remplace sa ligne au lieu d'en ajouter une seconde.",
	);
	await expect(changes.getByLabel("Date d'effet du changement 1")).toHaveValue("05/06/2023");
	await expect(changes.getByLabel("Taux du changement 1", { exact: true })).toHaveValue("2,00");

	// A row with a date and no rate is incomplete.
	await changes.getByRole("button", { name: "Ajouter un changement de taux" }).click();
	await changes.getByLabel("Date d'effet du changement 2").fill("05/01/2025");
	await dialog.getByRole("button", { name: "Enregistrer" }).click();
	const refusal = dialog.getByText(
		"Chaque changement de taux demande une date et un taux entre 0 et 100, trois décimales au plus.",
	);
	await expect(refusal).toBeVisible();

	// Before origination, the start date.
	await changes.getByLabel("Date d'effet du changement 2").fill("05/01/2020");
	await changes.getByLabel("Taux du changement 2", { exact: true }).fill("2,5");
	await dialog.getByRole("button", { name: "Enregistrer" }).click();
	await expect(
		dialog.getByText("Un changement de taux ne peut pas précéder la date d'origine du prêt."),
	).toBeVisible();

	await changes.getByLabel("Date d'effet du changement 2").fill("05/01/2025");
	await dialog.getByRole("combobox", { name: "Type de taux" }).click();
	await page.getByRole("option", { name: "Fixe" }).click();
	await expect(changes).toHaveCount(0);
	await dialog.getByRole("button", { name: "Enregistrer" }).click();

	await expect(dialog).toBeHidden();
	await expect(type).toContainText("Fixe");
	await page.getByRole("button", { name: `Actions du compte ${loan.name}` }).click();
	await page.getByRole("menuitem", { name: "Modifier" }).click();
	await expect(changes).toHaveCount(0);
	await dialog.getByRole("combobox", { name: "Type de taux" }).click();
	await page.getByRole("option", { name: "Révisable" }).click();
	await dialog.getByText("Changements de taux", { exact: true }).click();
	await expect(changes.getByLabel("Date d'effet du changement 1")).toHaveValue("05/06/2023");
	await expect(changes.getByLabel("Date d'effet du changement 2")).toHaveValue("05/01/2025");
	await expect(changes.getByLabel("Taux du changement 2", { exact: true })).toHaveValue("2,50");

	// Sure's « Remove »: a removed row is gone once saved.
	await changes.getByRole("button", { name: "Retirer du changement 1" }).click();
	await expect(changes.getByLabel("Date d'effet du changement 1")).toHaveValue("05/01/2025");
	await expect(changes.getByLabel("Date d'effet du changement 2")).toHaveCount(0);
	await dialog.getByRole("button", { name: "Enregistrer" }).click();
	await expect(dialog).toBeHidden();
	await page.getByRole("button", { name: `Actions du compte ${loan.name}` }).click();
	await page.getByRole("menuitem", { name: "Modifier" }).click();
	await dialog.getByText("Changements de taux", { exact: true }).click();
	await expect(changes.getByLabel(/^Date d'effet du changement/u)).toHaveCount(1);
	await expect(changes.getByLabel("Taux du changement 1", { exact: true })).toHaveValue("2,50");
});

// Story 24.2: the amortisation schedule.

test("the owner's ING mortgage shows its schedule as his bank's table, and follows its saved terms", async ({
	page,
	api,
}) => {
	const loan = await api.openAccount({
		name: uniqueName("Prêt immobilier"),
		kind: "mortgage",
		openingBalance: "104 724,54",
		details: {
			originalAmount: "130 000,00",
			startDate: "2020-12-05",
			termMonths: "300",
			rateType: "fixed",
			interestRate: "1,82",
			insuranceRate: "0,2917",
			insuranceRateType: "level_term",
		},
	});

	await page.goto(`/accounts/${loan.id}`);
	const tabs = page.getByRole("tablist", { name: "Vues du compte" });
	await expect(tabs.getByRole("tab")).toHaveText([
		"Opérations",
		"Aperçu",
		"Échéancier",
		"Soldes",
		"Imports",
	]);
	await tabs.getByRole("tab", { name: "Échéancier" }).click();
	await expect(page).toHaveURL(/tab=schedule/u);

	const panel = page.getByRole("tabpanel", { name: "Échéancier" });
	// Sure's cards, one figure each.
	await expect(panel.getByRole("group", { name: "Paiement mensuel", exact: true })).toContainText(
		euros(53_969),
	);
	await expect(panel.getByRole("group", { name: "Intérêts totaux" })).toContainText(
		euros(3_190_696),
	);
	await expect(panel.getByRole("group", { name: "Coût total" })).toContainText(euros(16_190_696));
	await expect(panel.getByRole("group", { name: "Paiement initial" })).toHaveCount(0);
	await expect(
		panel.getByText(
			"Calculé à partir du solde initial du prêt, du taux et de la durée, depuis le 5 décembre 2020. Les remboursements anticipés n'y figurent pas.",
		),
	).toBeVisible();
	await expect(panel.getByText(/Le taux de ce prêt varie/u)).toHaveCount(0);

	const table = panel.getByRole("table", { name: "Échéancier" });
	await expect(table.getByRole("columnheader")).toHaveText([
		"N°",
		"Date",
		"Paiement",
		"Capital",
		"Intérêts",
		"Capital restant dû",
	]);
	const rows = table.getByRole("row");
	// The header row, then the 300 payments.
	await expect(rows).toHaveCount(301);
	await expect(rows.nth(69).getByRole("cell").nth(1)).toHaveText(
		"5 septembre 2026, échéance passée",
	);
	await expect(rows.nth(69).getByRole("cell").last()).toHaveText(euros(10_510_482));
	await expect(rows.nth(70).getByRole("cell")).toHaveText([
		"70",
		"5 octobre 2026, échéance passée",
		euros(53_969),
		euros(38_028),
		euros(15_941),
		euros(10_472_454),
	]);
	await expect(rows.nth(300).getByRole("cell")).toHaveText([
		"300",
		"5 décembre 2045",
		euros(53_965),
		/./u,
		/./u,
		euros(0),
	]);
	// Shaded up to today: payment 69 fell in September 2026, payment 300 falls in 2045.
	await expect(rows.nth(69)).toHaveAttribute("data-past");
	await expect(rows.nth(300)).not.toHaveAttribute("data-past");
	// DESIGN.md's `inset`, Sure's `bg-container-inset`: `muted` is the page's own grey.
	await expect(table.locator("tr[data-past]").last()).toHaveCSS("background-color", rgb("#f2f2f3"));

	await page.getByRole("button", { name: `Actions du compte ${loan.name}` }).click();
	await page.getByRole("menuitem", { name: "Modifier" }).click();
	const dialog = page.getByRole("dialog", { name: "Modifier le compte" });
	await dialog.getByLabel("Durée (mois)").fill("240");
	await dialog.getByRole("button", { name: "Enregistrer" }).click();
	await expect(dialog).toBeHidden();

	await expect(rows).toHaveCount(241);
	await expect(rows.last().getByRole("cell").nth(1)).toHaveText("5 décembre 2040");
});

// Story 24.3: the loan overview.

/**
 * The instalment the ING mortgage is on today in the suite's zone, as Sure's
 * `months_elapsed`: the one after the months fully served since 5 December
 * 2020, its payments falling on the 5th.
 */
function ingInstalmentToday(): { number: number; date: string } {
	const [year = 0, month = 0, day = 0] = daysAgo(0).split("-").map(Number);
	const elapsed = year * 12 + month - (2020 * 12 + 12) - (day < 5 ? 1 : 0);
	const number = elapsed + 1;
	const due = new Date(Date.UTC(2020, 11 + number, 5));

	return {
		number,
		date: new Intl.DateTimeFormat("fr-FR", {
			day: "numeric",
			month: "long",
			year: "numeric",
			timeZone: "UTC",
		}).format(due),
	};
}

test("the owner's ING mortgage shows its overview, and « Modifier les détails du prêt » opens its dialog", async ({
	page,
	api,
}) => {
	const loan = await api.openAccount({
		name: uniqueName("Prêt immobilier"),
		kind: "mortgage",
		openingBalance: "104 724,54",
		details: {
			originalAmount: "130 000,00",
			downPayment: "32 500,00",
			startDate: "2020-12-05",
			termMonths: "300",
			rateType: "fixed",
			interestRate: "1,82",
			insuranceRate: "0,2917",
			insuranceRateType: "level_term",
		},
	});

	await page.goto(`/accounts/${loan.id}`);
	await page
		.getByRole("tablist", { name: "Vues du compte" })
		.getByRole("tab", { name: "Aperçu" })
		.click();
	await expect(page).toHaveURL(/tab=overview/u);

	const panel = page.getByRole("tabpanel", { name: "Aperçu" });
	const card = (name: string) => panel.getByRole("group", { name, exact: true });
	await expect(card("Capital d'origine")).toContainText(euros(13_000_000));
	await expect(card("Capital restant")).toContainText(euros(10_472_454));
	await expect(card("Taux d'intérêt")).toContainText("1,820 %");
	await expect(card("Paiement mensuel")).toContainText(euros(53_969));
	await expect(card("Durée")).toContainText("25 ans");
	await expect(card("Date de fin d'origine")).toContainText("5 décembre 2045");
	await expect(card("Type")).toContainText("Fixe");
	await expect(card("Coût total assurance comprise")).toContainText(euros(17_138_696));
	await expect(card("Coût total")).toHaveCount(0);
	await expect(card("Assurance")).toContainText(euros(948_000));
	await expect(card("Effet de levier")).toContainText("4,0x");
	await expect(card("Effet de levier")).toContainText("Prudent");
	// Sure's `text-success`, in the green that keeps 4.5:1 on a card.
	await expect(card("Effet de levier").getByText("4,0x")).toHaveCSS("color", "rgb(29, 127, 52)");

	await expect(panel.getByText("Remboursé", { exact: true })).toBeVisible();
	const ring = panel.getByRole("img", { name: `19 % remboursé sur ${euros(13_000_000)}` });
	await expect(ring).toBeVisible();
	// Sure's ring draws the share repaid in its warning colour.
	await expect(ring.locator("circle").nth(1)).toHaveCSS("stroke", "rgb(166, 79, 42)");

	const { number, date } = ingInstalmentToday();
	await expect(panel.getByText(`Échéance ${number} · ${date}`)).toBeVisible();
	const parts = panel.getByRole("definition");
	await expect(panel.getByRole("term")).toHaveText(["Capital", "Intérêts", "Assurance", "Total"]);
	await expect(parts.nth(2)).toHaveText(`${euros(3_160)}6 %`);
	await expect(parts.nth(3)).toHaveText(euros(57_129));

	await panel.getByRole("button", { name: "Modifier les détails du prêt" }).click();
	const dialog = page.getByRole("dialog", { name: "Modifier le compte" });
	await expect(dialog.getByLabel("Solde initial du prêt")).toHaveValue("130000,00");
	await dialog.getByLabel("Taux d'assurance").fill("");
	await dialog.getByRole("button", { name: "Enregistrer" }).click();
	await expect(dialog).toBeHidden();

	await expect(card("Coût total")).toContainText(euros(16_190_696));
	await expect(card("Assurance")).toHaveCount(0);
	await expect(panel.getByRole("term")).toHaveText(["Capital", "Intérêts", "Total"]);
});

test("an overpaid, highly leveraged loan reads its balance by its size and its band in red, as Sure", async ({
	page,
	api,
}) => {
	const loan = await api.openAccount({
		name: uniqueName("Prêt"),
		kind: "mortgage",
		openingBalance: "-32 500,00",
		details: {
			originalAmount: "130 000,00",
			downPayment: "10 000,00",
			startDate: "2020-12-05",
			termMonths: "300",
			rateType: "fixed",
			interestRate: "1,82",
		},
	});

	await page.goto(`/accounts/${loan.id}?tab=overview`);
	const panel = page.getByRole("tabpanel", { name: "Aperçu" });
	const leverage = panel.getByRole("group", { name: "Effet de levier", exact: true });
	await expect(leverage).toContainText("13,0x");
	await expect(leverage).toContainText("Élevé");
	await expect(leverage.getByText("13,0x")).toHaveCSS("color", "rgb(201, 19, 19)");
	await expect(
		panel.getByRole("img", { name: `75 % remboursé sur ${euros(13_000_000)}` }),
	).toBeVisible();
});

test("a variable loan's schedule names its first payment and warns that its rate moves", async ({
	page,
	api,
}) => {
	const loan = await api.openAccount({
		name: uniqueName("Prêt"),
		kind: "mortgage",
		openingBalance: "100 000,00",
		details: {
			originalAmount: "130 000,00",
			startDate: "2020-12-05",
			termMonths: "300",
			rateType: "variable",
			interestRate: "1,82",
			rateChanges: [{ effectiveDate: "2023-06-05", rate: "3" }],
		},
	});

	await page.goto(`/accounts/${loan.id}?tab=schedule`);
	const panel = page.getByRole("tabpanel", { name: "Échéancier" });
	await expect(panel.getByRole("group", { name: "Paiement initial" })).toContainText(euros(53_969));
	await expect(panel.getByRole("group", { name: "Paiement mensuel", exact: true })).toHaveCount(0);
	await expect(
		panel.getByText(
			"Le taux de ce prêt varie dans le temps. L'échéancier est recalculé à chaque changement enregistré : la date de fin reste la même et le paiement est ajusté. Un changement pas encore enregistré modifiera ces chiffres.",
		),
	).toBeVisible();
});

// Story 24.4: where the loan is heading. The suite cannot pin the server's
// clock, so these assert the figures that hold on any day; the route spec
// pins 6 October 2026 for the rest.

/** The owner's ING mortgage terms, as Story 24.2 records them. */
const ingTerms = {
	originalAmount: "130 000,00",
	startDate: "2020-12-05",
	termMonths: "300",
	rateType: "fixed",
	interestRate: "1,82",
} as const;

/** The page x and width of the rect a loan chart line's group is clipped to. */
const clipOf = (group: Locator) =>
	group.evaluate((element) => {
		const id = /#([^)]+)/u.exec(element.getAttribute("clip-path") ?? "")?.[1] ?? "";
		const rect = document.getElementById(id)?.querySelector("rect");
		const left = element.closest("svg")?.getBoundingClientRect().left ?? 0;

		return { x: left + (rect?.x.baseVal.value ?? 0), width: rect?.width.baseVal.value ?? -1 };
	});

const dayOf = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

test("the ING mortgage repaid early charts its balance, its contract and where it leads, and the schedule names its payoff", async ({
	page,
	api,
}) => {
	const loan = await api.openAccount({
		name: uniqueName("Prêt immobilier"),
		kind: "mortgage",
		openingBalance: "94 724,54",
		details: ingTerms,
	});

	await page.goto(`/accounts/${loan.id}`);
	const card = page.getByRole("region", { name: "Historique du solde" });
	const legend = card.getByRole("list", { name: "Séries du graphique" });

	// A loan's chart opens on its whole life, as Sure's.
	await expect(card.getByRole("radio", { name: "Tout" })).toBeChecked();
	await expect(legend.getByRole("listitem")).toHaveText([
		"Solde enregistré",
		"Échéancier du contrat",
		"Projection",
	]);
	// Sure's count: the recorded line's greyed copy carries no `data-series`.
	await expect(card.locator("[data-series]")).toHaveCount(3);
	await expect(card.locator(".recharts-area")).toHaveCount(1);
	await expect(card.locator(".recharts-reference-line")).toHaveCount(1);

	// 10 000,00 € ahead of the contract, it finishes years early.
	const payoff = card.getByRole("group", { name: "Fin prévue" });
	await expect(payoff).toContainText(/\d{4}\d+ mois plus tôt que prévu$/u);
	await expect(card.getByRole("group", { name: "Intérêts économisés" })).toContainText(/€$/u);
	await expect(
		card.getByText(/^Compare le solde enregistré aujourd'hui au solde de l'échéancier/u),
	).toBeVisible();
	// Sure's change line: today's balance against the amount borrowed, a fall in green.
	const trend = card.getByText(
		new RegExp(`^${euros(-3_527_546)} \\(−27,1.%\\) depuis le début du prêt$`, "u"),
	);
	await expect(trend).toBeVisible();
	await expect(trend.getByText(/^−/u)).toHaveCSS("color", "rgb(29, 127, 52)");
	// Sure's description, for screen readers; the « Échéancier » tab carries the figures.
	const description = card.getByText(
		new RegExp(
			`^Graphique du solde du prêt\\. Solde enregistré : ${euros(9_472_454)}\\. Fin prévue au contrat : 5 décembre 2045\\. Fin projetée depuis le solde d'aujourd'hui : \\d+ \\p{L}+ 20\\d\\d\\.`,
			"u",
		),
	);
	await expect(description).toHaveClass(/sr-only/u);
	await expect(card.getByRole("button", { name: "Voir le tableau" })).toHaveCount(0);

	// Sure's tooltip splits a scheduled payment into what it repays; the
	// amount borrowed, at the origin, is no payment.
	const plot = await card.locator(".recharts-cartesian-grid").boundingBox();
	const tooltip = card.locator(".recharts-tooltip-wrapper");
	const split = tooltip.getByText(/^Capital : /u);
	expect(plot).not.toBeNull();
	// Sure greys the recorded line past the payment the tooltip snaps to,
	// one clip edge shared by the coloured line and its greyed copy.
	const shadow = card.locator('[data-series-shadow="actual"]');
	const coloured = card.locator('[data-series="actual"]');
	const futureClip = () => clipOf(shadow);
	const pastClip = () => clipOf(coloured);
	// The recorded balance has not moved since it was opened: a flat line,
	// which Playwright never calls visible, so the clips say what is drawn.
	await expect(coloured).toHaveCount(1);
	await expect(shadow).toHaveCount(1);
	await expect.poll(async () => (await futureClip()).width).toBe(0);
	expect(Math.abs((await pastClip()).width - plot!.width)).toBeLessThanOrEqual(1);
	await page.mouse.move(plot!.x + plot!.width * 0.4, plot!.y + plot!.height / 2);
	await expect(split).toHaveText(/^Capital : \d[\d\s]*,\d\d\s€ · Intérêts : \d[\d\s]*,\d\d\s€$/u);
	const edge = await futureClip();
	const past = await pastClip();
	expect(edge.width).toBeGreaterThan(plot!.width * 0.5);
	expect(Math.abs(past.x + past.width - edge.x)).toBeLessThan(1);
	// At 1.82 %, every payment repays more capital than interest.
	const [principal, interest] = ((await split.textContent()) ?? "")
		.match(/\d[\d\s]*,\d\d/gu)!
		.map((amount) => Number(amount.replaceAll(/\s/gu, "").replace(",", ".")));
	expect(principal).toBeGreaterThan(interest!);
	await page.mouse.move(plot!.x + 1, plot!.y + plot!.height / 2);
	await expect(tooltip).toContainText("Échéancier du contrat");
	await expect(split).toHaveCount(0);
	await page.mouse.move(0, 0);
	await expect.poll(async () => (await futureClip()).width).toBe(0);

	// The keyboard moves the split as the pointer does.
	const surface = card.locator(".recharts-surface");
	await surface.focus();
	await page.keyboard.press("ArrowRight");
	await expect.poll(async () => (await futureClip()).width).toBeGreaterThan(plot!.width * 0.9);
	const first = (await futureClip()).x;
	// Each key steps one plotted date; several may snap to the same payment.
	await expect
		.poll(async () => {
			await page.keyboard.press("ArrowRight");

			return (await futureClip()).x;
		})
		.toBeGreaterThan(first);
	await surface.blur();
	await expect.poll(async () => (await futureClip()).width).toBe(0);

	// A window ends today, where the projection draws no line.
	await card.getByRole("radio", { name: "1 A" }).click();
	await expect(page).toHaveURL(/period=1Y/u);
	await expect(legend.getByRole("listitem")).toHaveText([
		"Solde enregistré",
		"Échéancier du contrat",
	]);
	await expect(payoff).toContainText(/mois plus tôt que prévu$/u);

	// A payment a month apart: the split sits on the payment the tooltip heads with.
	const oneYear = z
		.object({
			data: z.object({
				from: z.string(),
				to: z.string(),
				scheduled: z.array(z.object({ date: z.string() })),
			}),
		})
		.parse(
			await (await page.request.get(`/api/accounts/${loan.id}/payoff-chart?period=1Y`)).json(),
		).data;
	const monthOf = new Intl.DateTimeFormat("fr-FR", {
		month: "short",
		year: "numeric",
		timeZone: "UTC",
	});
	await page.mouse.move(plot!.x + plot!.width * 0.4, plot!.y + plot!.height / 2);
	const heading = (await tooltip.locator("span").first().textContent()) ?? "";
	const payment = oneYear.scheduled.find(
		({ date }) =>
			date >= oneYear.from && date <= oneYear.to && monthOf.format(dayOf(date)) === heading,
	);
	expect(payment, `no payment in ${heading}`).toBeDefined();
	const paymentX =
		plot!.x +
		(plot!.width * (dayOf(payment!.date) - dayOf(oneYear.from))) /
			(dayOf(oneYear.to) - dayOf(oneYear.from));
	await expect.poll(async () => Math.abs((await futureClip()).x - paymentX)).toBeLessThan(2);
	await page.mouse.move(0, 0);

	await page.getByRole("tab", { name: "Échéancier" }).click();
	const scheduled = page
		.getByRole("tabpanel", { name: "Échéancier" })
		.getByRole("group", { name: "Fin prévue" });
	await expect(scheduled).toContainText(/^Fin prévue\d+ \p{L}+ 20\d\d$/u);

	// Shorter terms repay more each month, so both follow at once.
	const before = await payoff.textContent();
	const scheduledBefore = await scheduled.textContent();
	await page.getByRole("button", { name: `Actions du compte ${loan.name}` }).click();
	await page.getByRole("menuitem", { name: "Modifier" }).click();
	const dialog = page.getByRole("dialog", { name: "Modifier le compte" });
	await dialog.getByLabel("Durée (mois)").fill("240");
	await dialog.getByRole("button", { name: "Enregistrer" }).click();
	await expect(dialog).toBeHidden();
	await expect(payoff).not.toHaveText(before ?? "");
	await expect(scheduled).not.toHaveText(scheduledBefore ?? "");
});

test("a loan its contract no longer clears names what is left at maturity, and the schedule says it is not paid off", async ({
	page,
	api,
}) => {
	const loan = await api.openAccount({
		name: uniqueName("Prêt immobilier"),
		kind: "mortgage",
		openingBalance: "130 000,00",
		details: ingTerms,
	});

	await page.goto(`/accounts/${loan.id}`);
	const card = page.getByRole("region", { name: "Historique du solde" });

	await expect(
		card.getByText(
			/^Au remboursement actuel, ce solde n'est pas soldé à l'échéance du contrat : .+\s€ resteraient dus\.$/u,
		),
	).toBeVisible();
	await expect(card.getByRole("group", { name: "Fin prévue" })).toHaveCount(0);
	await expect(
		card.getByText(
			/Fin projetée depuis le solde d'aujourd'hui : aucune au remboursement actuel\./u,
		),
	).toBeVisible();

	await page.getByRole("tab", { name: "Échéancier" }).click();
	await expect(
		page.getByRole("tabpanel", { name: "Échéancier" }).getByRole("group", { name: "Fin prévue" }),
	).toContainText("Non soldé à l'échéance");

	// Nothing owed: nothing to project.
	const repaid = await api.openAccount({
		name: uniqueName("Prêt immobilier"),
		kind: "mortgage",
		openingBalance: "0",
		details: ingTerms,
	});
	await page.goto(`/accounts/${repaid.id}?tab=schedule`);
	await expect(
		page.getByRole("tabpanel", { name: "Échéancier" }).getByRole("group", { name: "Fin prévue" }),
	).toContainText("N/D");
	await expect(card.getByRole("group", { name: "Fin prévue" })).toHaveCount(0);
});

test("a loan without an amount borrowed amortises its opening balance from its opening date, as Sure's", async ({
	page,
	api,
}) => {
	const loan = await api.openAccount({
		name: uniqueName("Prêt immobilier"),
		kind: "mortgage",
		openingBalance: "130 000,00",
		openingDate: "2020-12-05",
		details: { ...ingTerms, originalAmount: "", startDate: "" },
	});

	await page.goto(`/accounts/${loan.id}?tab=schedule`);

	const tabs = page.getByRole("tablist", { name: "Vues du compte" });
	await expect(tabs.getByRole("tab")).toHaveText([
		"Opérations",
		"Aperçu",
		"Échéancier",
		"Soldes",
		"Imports",
	]);
	const schedule = page.getByRole("tabpanel", { name: "Échéancier" });
	await expect(
		schedule.getByRole("group", { name: "Paiement mensuel", exact: true }),
	).toContainText(euros(53_969));
	await expect(schedule.getByText(/depuis le 5 décembre 2020\./u)).toBeVisible();

	// The loan chart, from the opening balance.
	const chart = page.getByRole("region", { name: "Historique du solde" });
	await expect(chart.getByRole("radio", { name: "Tout" })).toBeChecked();
	await expect(chart.getByRole("list", { name: "Séries du graphique" })).toBeVisible();

	await tabs.getByRole("tab", { name: "Aperçu" }).click();
	const overview = page.getByRole("tabpanel", { name: "Aperçu" });
	const card = (name: string) => overview.getByRole("group", { name, exact: true });
	await expect(card("Capital d'origine")).toContainText(euros(13_000_000));
	await expect(card("Paiement mensuel")).toContainText(euros(53_969));
	await expect(card("Date de fin d'origine")).toContainText("5 décembre 2045");
	await expect(
		overview.getByRole("img", { name: `0 % remboursé sur ${euros(13_000_000)}` }),
	).toBeVisible();
});

test("a loan without a term has no « Échéancier » tab, and a link to it opens « Opérations »", async ({
	page,
	api,
}) => {
	const loan = await api.openAccount({
		name: uniqueName("Prêt"),
		kind: "auto",
		openingBalance: "8 000,00",
		details: {
			rateType: "fixed",
			interestRate: "4,9",
			insuranceRate: "0,2917",
			insuranceRateType: "level_term",
		},
	});

	await page.goto(`/accounts/${loan.id}?tab=schedule`);

	const tabs = page.getByRole("tablist", { name: "Vues du compte" });
	await expect(tabs.getByRole("tab", { name: "Opérations" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(tabs.getByRole("tab")).toHaveText(["Opérations", "Aperçu", "Soldes", "Imports"]);

	// Without a schedule, it keeps the account's balance chart and its month.
	const chart = page.getByRole("region", { name: "Historique du solde" });
	await expect(chart.getByRole("radio", { name: "1 M" })).toBeChecked();
	await expect(chart.getByText(`Solde : ${euros(800_000)}`)).toBeVisible();
	await expect(chart.getByRole("list", { name: "Séries du graphique" })).toHaveCount(0);

	// Its overview measures it by its opening balance and names what it cannot compute « Inconnu ».
	await tabs.getByRole("tab", { name: "Aperçu" }).click();
	const panel = page.getByRole("tabpanel", { name: "Aperçu" });
	const card = (name: string) => panel.getByRole("group", { name, exact: true });
	await expect(card("Capital d'origine")).toContainText(euros(800_000));
	await expect(card("Capital restant")).toContainText(euros(800_000));
	await expect(card("Taux d'intérêt")).toContainText("4,900 %");
	await expect(card("Paiement mensuel")).toContainText("Inconnu");
	await expect(card("Durée")).toContainText("Inconnu");
	await expect(card("Date de fin d'origine")).toContainText("Inconnu");
	await expect(card("Coût total")).toContainText("Inconnu");
	await expect(card("Effet de levier")).toHaveCount(0);
	await expect(card("Assurance")).toContainText("0,292 % par an");
	await expect(
		panel.getByRole("img", { name: `0 % remboursé sur ${euros(800_000)}` }),
	).toBeVisible();
	await expect(panel.getByText(/^Échéance /u)).toHaveCount(0);
});

test("a loan saved through the API with a term of 0 has no « Échéancier » and pays nothing, as Sure's", async ({
	page,
	api,
}) => {
	const loan = await api.openAccount({
		name: uniqueName("Prêt"),
		kind: "auto",
		openingBalance: "8 000,00",
		details: { originalAmount: "10 000,00", rateType: "fixed", interestRate: "3", termMonths: "0" },
	});

	await page.goto(`/accounts/${loan.id}?tab=schedule`);

	const tabs = page.getByRole("tablist", { name: "Vues du compte" });
	await expect(tabs.getByRole("tab", { name: "Opérations" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(tabs.getByRole("tab")).toHaveText(["Opérations", "Aperçu", "Soldes", "Imports"]);
	const chart = page.getByRole("region", { name: "Historique du solde" });
	await expect(chart.getByText(`Solde : ${euros(800_000)}`)).toBeVisible();
	await expect(chart.getByRole("list", { name: "Séries du graphique" })).toHaveCount(0);

	await tabs.getByRole("tab", { name: "Aperçu" }).click();
	const panel = page.getByRole("tabpanel", { name: "Aperçu" });
	const card = (name: string) => panel.getByRole("group", { name, exact: true });
	await expect(card("Paiement mensuel")).toContainText(euros(0));
	await expect(card("Durée")).toContainText("0 mois");
	await expect(card("Date de fin d'origine")).toContainText("Inconnu");
});

test("an account that is not a loan, a property or a vehicle has no « Échéancier » nor « Aperçu » tab, and a link to either opens « Opérations »", async ({
	page,
	api,
}) => {
	const account = await api.openAccount();

	await page.goto(`/accounts/${account.id}?tab=schedule`);

	const tabs = page.getByRole("tablist", { name: "Vues du compte" });
	await expect(tabs.getByRole("tab", { name: "Opérations" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(tabs.getByRole("tab", { name: "Échéancier" })).toHaveCount(0);

	await page.goto(`/accounts/${account.id}?tab=overview`);
	await expect(tabs.getByRole("tab", { name: "Opérations" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(tabs.getByRole("tab", { name: "Aperçu" })).toHaveCount(0);
});

// Story 7.2: investment accounts.

test("a PEA created through the form is listed under « Actifs » with its value and caption, and in the accounts column", async ({
	page,
	api,
}) => {
	// A name without « PEA », so the caption alone can show it.
	const name = uniqueName("Plan actions");
	const before = await api.groupTotal("asset");

	await page.goto("/accounts");
	await addAccount(page).click();
	const dialog = page.getByRole("dialog", { name: "Ajouter un compte" });
	await dialog.getByLabel("Nom").fill(name);
	await dialog.getByRole("combobox", { name: "Type" }).click();
	await page.getByRole("option", { name: "Plan d'Épargne en Actions" }).click();
	await expect(dialog.getByLabel("Solde initial du prêt")).toHaveCount(0);
	await dialog.getByLabel("Solde à la date :").fill("25 000,00");
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

	await expect(
		column(page)
			.getByRole("group", { name: "Investissement" })
			.getByRole("link", { name: new RegExp(name) }),
	).toContainText(euros(2_500_000));
});

// Story 28.5: Sure's investment subtypes, grouped by region, long in the
// select and short in the lists.
test("a pillar 3a created under « Europe » through the form is listed as « Pilier 3a »", async ({
	page,
}) => {
	const name = uniqueName("Prévoyance");

	await page.goto("/accounts");
	await addAccount(page).click();
	const dialog = page.getByRole("dialog", { name: "Ajouter un compte" });
	await dialog.getByLabel("Nom").fill(name);
	await dialog.getByRole("combobox", { name: "Type" }).click();
	await expect(page.getByRole("group", { name: "Europe" }).getByRole("option")).toHaveText([
		"Assurance-vie",
		"Plan d'Épargne en Actions",
		"Prévoyance privée (Pilier 3a)",
		"Riester-Rente",
	]);
	await expect(page.getByRole("group", { name: "Général" }).getByRole("option")).toHaveText([
		"Retraite",
		"Compte de retraite",
		"Fonds commun de placement",
		"Or (physique ou numérique)",
		"Investissement providentiel",
		"Fiducie",
		"Autre investissement",
	]);
	await expect(page.getByRole("group", { name: "États-Unis" }).getByRole("option")).toHaveText([
		"Compte-titres",
	]);
	await page
		.getByRole("group", { name: "Europe" })
		.getByRole("option", { name: "Prévoyance privée (Pilier 3a)" })
		.click();
	await dialog.getByLabel("Solde à la date :").fill("3 000,00");
	await dialog.getByRole("button", { name: "Ajouter le compte" }).click();
	await expect(dialog).toBeHidden();

	const row = page
		.getByRole("region", { name: "Actifs" })
		.getByRole("link", { name: new RegExp(name) });
	await expect(row.getByText("Pilier 3a", { exact: true })).toBeVisible();
	await expect(row).toContainText(euros(300_000));
});

// Story 28.5: Sure's `include_blank`, named as Sure names the type.
test("an investment created without a subtype through the form reads « Investissement »", async ({
	page,
}) => {
	const name = uniqueName("Placement");

	await page.goto("/accounts");
	await addAccount(page).click();
	const dialog = page.getByRole("dialog", { name: "Ajouter un compte" });
	await dialog.getByLabel("Nom").fill(name);
	await dialog.getByRole("combobox", { name: "Type" }).click();
	await page.getByRole("option", { name: "Investissement", exact: true }).click();
	await dialog.getByLabel("Solde à la date :").fill("1 000,00");
	await dialog.getByRole("button", { name: "Ajouter le compte" }).click();
	await expect(dialog).toBeHidden();

	const row = page
		.getByRole("region", { name: "Actifs" })
		.getByRole("link", { name: new RegExp(name) });
	await expect(row.getByText("Investissement", { exact: true })).toBeVisible();
	await expect(row).toContainText(euros(100_000));
});

// Story 7.3: property and vehicle accounts.

test("a home created through the form with its estimated value is listed under « Actifs » with its caption, and in the accounts column", async ({
	page,
	api,
}) => {
	// A name without « Maison », so the caption alone can show it.
	const name = uniqueName("Résidence principale");
	const before = await api.groupTotal("asset");

	await page.goto("/accounts");
	await addAccount(page).click();
	const dialog = page.getByRole("dialog", { name: "Ajouter un compte" });
	await dialog.getByLabel("Nom").fill(name);
	// Sure's dialog has a title and no description.
	await expect(dialog).not.toHaveAttribute("aria-describedby");
	await dialog.getByRole("combobox", { name: "Type" }).click();
	await page.getByRole("option", { name: "Maison", exact: true }).click();
	await dialog.getByLabel("Solde à la date :").fill("320 000,00");
	await dialog.getByLabel("Date du solde d'ouverture").fill(typed(daysAgo(10)));
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
		column(page)
			.getByRole("group", { name: "Bien immobilier" })
			.getByRole("link", { name: new RegExp(name) }),
	).toContainText(euros(32_000_000));
});

test("a vehicle created through the form with its estimated value is listed under « Actifs » with its caption", async ({
	page,
}) => {
	const name = uniqueName("Voiture");

	await page.goto("/accounts");
	await addAccount(page).click();
	const dialog = page.getByRole("dialog", { name: "Ajouter un compte" });
	await dialog.getByLabel("Nom").fill(name);
	await dialog.getByRole("combobox", { name: "Type" }).click();
	await page.getByRole("option", { name: "Véhicule", exact: true }).click();
	await dialog.getByLabel("Solde à la date :").fill("18 500,00");
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

// Story 28.10: Sure's `OtherAsset` and `OtherLiability`.
test("an other asset shows Sure's valuation notice when created and edited, an other liability none, each in its group", async ({
	page,
}) => {
	const notice =
		"Les autres actifs sont suivis via des valorisations manuelles à l'aide de « Ajouter un solde », et non via des transactions. Les flux de trésorerie n'affecteront pas le solde du compte.";
	const jewellery = uniqueName("Bijoux");
	const relative = uniqueName("Prêt de Marie");

	await page.goto("/accounts");
	await addAccount(page).click();
	const dialog = page.getByRole("dialog", { name: "Ajouter un compte" });
	await expect(dialog.getByRole("note")).toHaveCount(0);
	await dialog.getByLabel("Nom").fill(jewellery);
	await dialog.getByRole("combobox", { name: "Type" }).click();
	await page.getByRole("option", { name: "Autre actif", exact: true }).click();
	await expect(dialog.getByRole("note")).toHaveText(notice);
	await dialog.getByLabel("Solde à la date :").fill("5 000,00");
	await dialog.getByRole("button", { name: "Ajouter le compte" }).click();
	await expect(dialog).toBeHidden();

	const assetRow = page
		.getByRole("region", { name: "Actifs" })
		.getByRole("link", { name: new RegExp(jewellery) });
	await expect(assetRow.getByText("Autre actif", { exact: true })).toBeVisible();
	await expect(assetRow).toContainText(euros(500_000));
	await expect(
		column(page)
			.getByRole("group", { name: "Autres actifs" })
			.getByRole("link", { name: new RegExp(jewellery) }),
	).toContainText(euros(500_000));

	await addAccount(page).click();
	await dialog.getByLabel("Nom").fill(relative);
	await dialog.getByRole("combobox", { name: "Type" }).click();
	await page.getByRole("option", { name: "Autre passif", exact: true }).click();
	await expect(dialog.getByRole("note")).toHaveCount(0);
	await dialog.getByLabel("Solde à la date :").fill("2 000,00");
	await dialog.getByRole("button", { name: "Ajouter le compte" }).click();
	await expect(dialog).toBeHidden();

	const liabilityRow = page
		.getByRole("region", { name: "Passifs" })
		.getByRole("link", { name: new RegExp(relative) });
	await expect(liabilityRow.getByText("Autre passif", { exact: true })).toBeVisible();
	await expect(liabilityRow).toContainText(euros(200_000));
	await expect(
		column(page)
			.getByRole("group", { name: "Autres passifs" })
			.getByRole("link", { name: new RegExp(relative) }),
	).toContainText(euros(200_000));

	await assetRow.click();
	await page.getByRole("button", { name: `Actions du compte ${jewellery}` }).click();
	await page.getByRole("menuitem", { name: "Modifier" }).click();
	const edit = page.getByRole("dialog", { name: "Modifier le compte" });
	await expect(edit.getByRole("note")).toHaveText(notice);
	// One kind, so nothing to choose.
	await expect(edit.getByLabel("Type", { exact: true })).toHaveCount(0);
	await edit.getByRole("button", { name: "Annuler" }).click();

	await page.goto("/accounts");
	await page
		.getByRole("region", { name: "Passifs" })
		.getByRole("link", { name: new RegExp(relative) })
		.click();
	await page.getByRole("button", { name: `Actions du compte ${relative}` }).click();
	await page.getByRole("menuitem", { name: "Modifier" }).click();
	await expect(edit.getByLabel("Nom")).toHaveValue(relative);
	await expect(edit.getByRole("note")).toHaveCount(0);
});

// Story 28.8: Sure's property and vehicle details, and their « Aperçu ».
test("a property created with its details shows its address under its caption and Sure's cards in « Aperçu »", async ({
	page,
}) => {
	const name = uniqueName("Appartement Lyon");

	await page.goto("/accounts");
	await addAccount(page).click();
	const dialog = page.getByRole("dialog", { name: "Ajouter un compte" });
	await dialog.getByLabel("Nom").fill(name);
	await dialog.getByRole("combobox", { name: "Type" }).click();
	await page.getByRole("option", { name: "Copropriété", exact: true }).click();
	await dialog.getByLabel("Solde à la date :").fill("250 000,00");
	await expect(dialog.getByLabel("Année de construction")).toHaveAttribute("placeholder", "2000");
	await expect(dialog.getByRole("combobox", { name: "Unité de mesure" })).toHaveText(
		"Mètres carrés",
	);
	// Sure's form bounds the year built; the API alone would save it.
	await dialog.getByLabel("Année de construction").fill("1200");
	await dialog.getByRole("button", { name: "Ajouter le compte" }).click();
	await expect(dialog.getByLabel("Année de construction")).toHaveAccessibleDescription(
		`Indiquez une année de 1500 à ${new Date().getFullYear()}.`,
	);
	await dialog.getByLabel("Année de construction").fill("1975");
	await dialog.getByLabel("Surface habitable").fill("68");
	await dialog.getByLabel("Adresse").fill("3 rue Mercière");
	await dialog.getByLabel("Ville").fill("Lyon");
	await dialog.getByLabel("Code postal/ZIP").fill("69002");
	await dialog.getByLabel("Pays").fill("FR");
	await dialog.getByRole("button", { name: "Ajouter le compte" }).click();
	await expect(dialog).toBeHidden();

	await page
		.getByRole("region", { name: "Actifs" })
		.getByRole("link", { name: new RegExp(name) })
		.click();
	await expect(page.getByText("3 rue Mercière, Lyon, 69002 FR", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Aperçu" }).click();
	const overview = page.getByRole("tabpanel", { name: "Aperçu" });
	const card = (title: string) => overview.getByRole("group", { name: title, exact: true });
	await expect(overview.getByRole("group")).toHaveText([
		/^Valeur marchande/u,
		/^Prix d'achat/u,
		/^Tendance/u,
		/^Année de construction/u,
		/^Surface habitable/u,
	]);
	await expect(card("Valeur marchande")).toContainText(euros(25_000_000));
	await expect(card("Prix d'achat")).toContainText(euros(25_000_000));
	await expect(card("Année de construction")).toContainText("1975");
	await expect(card("Surface habitable")).toContainText(/68\sm²/u);

	await overview.getByRole("button", { name: "Modifier les détails du compte" }).click();
	const edit = page.getByRole("dialog", { name: "Modifier le compte" });
	await expect(edit.getByLabel("Année de construction")).toHaveValue("1975");
	await expect(edit.getByLabel("Adresse")).toHaveValue("3 rue Mercière");
	await edit.getByRole("combobox", { name: "Unité de mesure" }).click();
	await page.getByRole("option", { name: "Pieds carrés", exact: true }).click();
	await edit.getByRole("button", { name: "Enregistrer" }).click();
	await expect(edit).toBeHidden();
	await expect(card("Surface habitable")).toContainText(/68\spi²/u);
});

test("a vehicle created with its mileage reads it in « Aperçu », and its details are edited from there", async ({
	page,
	api,
}) => {
	const name = uniqueName("Voiture");

	await page.goto("/accounts");
	await addAccount(page).click();
	const dialog = page.getByRole("dialog", { name: "Ajouter un compte" });
	await dialog.getByLabel("Nom").fill(name);
	await dialog.getByRole("combobox", { name: "Type" }).click();
	await page.getByRole("option", { name: "Véhicule", exact: true }).click();
	await dialog.getByLabel("Solde à la date :").fill("18 500,00");
	await dialog.getByLabel("Date du solde d'ouverture").fill(typed(daysAgo(60)));
	await dialog.getByLabel("Marque").fill("Peugeot");
	await dialog.getByLabel("Modèle").fill("208");
	await dialog.getByLabel("Année", { exact: true }).fill("2021");
	await dialog.getByLabel("Kilométrage").fill("15000");
	await expect(dialog.getByRole("combobox", { name: "Unité" })).toHaveText("Kilomètres");
	await dialog.getByRole("button", { name: "Ajouter le compte" }).click();
	await expect(dialog).toBeHidden();

	await page
		.getByRole("region", { name: "Actifs" })
		.getByRole("link", { name: new RegExp(name) })
		.click();
	const id = new URL(page.url()).pathname.split("/").at(-1) ?? "";
	await api.recordSnapshot(id, { date: daysAgo(5), balance: "17 000,00" });
	await page.getByRole("tab", { name: "Aperçu" }).click();
	const overview = page.getByRole("tabpanel", { name: "Aperçu" });
	const card = (title: string) => overview.getByRole("group", { name: title, exact: true });
	await expect(overview.getByRole("group")).toHaveText([
		/^Marque et modèle/u,
		/^Année/u,
		/^Kilométrage/u,
		/^Prix d'achat/u,
		/^Prix actuel/u,
		/^Tendance/u,
	]);
	await expect(card("Marque et modèle")).toContainText("Peugeot 208");
	await expect(card("Kilométrage")).toContainText(/15\s000\skm/u);
	await expect(card("Prix d'achat")).toContainText(euros(1_850_000));
	await expect(card("Prix actuel")).toContainText(euros(1_700_000));
	await expect(card("Tendance")).toContainText(euros(-150_000));
	await expect(card("Tendance")).toContainText("(−8,1 %)");

	await overview.getByRole("button", { name: "Modifier les détails du compte" }).click();
	const edit = page.getByRole("dialog", { name: "Modifier le compte" });
	await expect(edit.getByLabel("Marque")).toHaveValue("Peugeot");
	await expect(edit.getByLabel("Kilométrage")).toHaveValue("15000");
	await expect(edit.getByRole("combobox", { name: "Unité" })).toHaveText("Kilomètres");
	await edit.getByLabel("Kilométrage").fill("-1");
	await edit.getByRole("button", { name: "Enregistrer" }).click();
	await expect(edit.getByLabel("Kilométrage")).toHaveAccessibleDescription(
		"Le kilométrage ne peut pas être négatif.",
	);
	await edit.getByLabel("Kilométrage").fill("21000");
	await edit.getByRole("combobox", { name: "Unité" }).click();
	await page.getByRole("option", { name: "Miles", exact: true }).click();
	await edit.getByRole("button", { name: "Enregistrer" }).click();
	await expect(edit).toBeHidden();
	await expect(card("Kilométrage")).toContainText(/21\s000\smi/u);

	await overview.getByRole("button", { name: "Modifier les détails du compte" }).click();
	await expect(edit.getByLabel("Kilométrage")).toHaveValue("21000");
	await expect(edit.getByRole("combobox", { name: "Unité" })).toHaveText("Miles");
});

test("a property without details reads « Inconnu », and no address line shows under its caption", async ({
	page,
	api,
}) => {
	const home = await api.openAccount({
		name: uniqueName("Maison"),
		kind: "single_family_home",
		openingBalance: "320 000,00",
	});

	await page.goto(`/accounts/${home.id}?tab=overview`);
	const overview = page.getByRole("tabpanel", { name: "Aperçu" });
	await expect(
		overview.getByRole("group", { name: "Année de construction", exact: true }),
	).toContainText("Inconnu");
	await expect(
		overview.getByRole("group", { name: "Surface habitable", exact: true }),
	).toContainText("Inconnu");
	// The caption and the value alone: Sure's subtitle only shows an address.
	await expect(page.getByRole("region", { name: home.name })).toHaveText(
		`Maison${euros(32_000_000)}`,
	);
});

test("invalid fields show their message next to the field", async ({ page }) => {
	await page.goto("/accounts");
	await addAccount(page).click();

	const dialog = page.getByRole("dialog", { name: "Ajouter un compte" });
	await dialog.getByLabel("Solde à la date :").fill("douze");
	await dialog.getByRole("button", { name: "Ajouter le compte" }).click();

	await expect(dialog.getByLabel("Nom")).toHaveAccessibleDescription("Ce champ est obligatoire.");
	await expect(dialog.getByLabel("Solde à la date :")).toHaveAccessibleDescription(
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
	await addAccount(page).click();

	const dialog = page.getByRole("dialog", { name: "Ajouter un compte" });
	await dialog.getByLabel("Nom").fill(uniqueName("Refusé"));
	await dialog.getByLabel("Solde à la date :").fill("10");
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

	await page.getByRole("button", { name: "admin@archant.test" }).click();
	await expect(page.getByRole("menuitemradio", { name: "Système" })).toHaveAttribute(
		"aria-checked",
		"true",
	);
	await page.getByRole("menuitemradio", { name: "Sombre" }).click();
	await expect(root).toHaveClass(/dark/u);

	await page.reload();
	await expect(root).toHaveClass(/dark/u);

	await page.getByRole("button", { name: "admin@archant.test" }).click();
	await expect(page.getByRole("menuitemradio", { name: "Sombre" })).toHaveAttribute(
		"aria-checked",
		"true",
	);
	await page.getByRole("menuitemradio", { name: "Clair" }).click();
	await expect(root).not.toHaveClass(/dark/u);
});
