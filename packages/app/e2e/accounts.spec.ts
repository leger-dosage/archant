import type { Page } from "@playwright/test";

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
	await dialog.getByLabel("Solde initial").fill("1 234,56");
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

test("the owner's ING mortgage created through the form is listed under « Passifs », its header naming its terms", async ({
	page,
}) => {
	const name = uniqueName("Prêt immobilier");

	await page.goto("/accounts");
	await addAccount(page).click();
	const dialog = page.getByRole("dialog", { name: "Ajouter un compte" });
	await dialog.getByLabel("Nom").fill(name);
	await dialog.getByRole("combobox", { name: "Type", exact: true }).click();
	await page.getByRole("option", { name: "Prêt immobilier" }).click();
	await expect(dialog.getByLabel("Solde initial")).toHaveCount(0);
	await dialog.getByLabel("Capital restant dû").fill("104 724,54");
	await dialog.getByLabel("Montant emprunté").fill("130 000,00");
	await dialog.getByLabel("Apport personnel").fill("0");
	await expect(dialog.getByLabel("Date d'origine")).toHaveAccessibleDescription(
		"Laissez vide pour prendre la date d'ouverture du compte",
	);
	await dialog.getByLabel("Date d'origine").fill("05/12/2020");
	await dialog.getByLabel("Durée (mois)").fill("300");
	await dialog.getByLabel("Taux d'intérêt (%)").fill("1,82");
	// A typed rate is fixed until said otherwise.
	await expect(dialog.getByRole("combobox", { name: "Type de taux" })).toHaveText("Fixe");
	await expect(dialog.getByRole("group", { name: "Changements de taux" })).toHaveCount(0);
	await dialog.getByLabel("Taux d'assurance (%)").fill("0,2917");
	await expect(dialog.getByRole("combobox", { name: "Type d'assurance" })).toHaveText("Aucune");
	await expect(
		dialog.getByRole("combobox", { name: "Type d'assurance" }),
	).toHaveAccessibleDescription(
		"Un taux annuel, prélevé chaque mois en complément de la mensualité. L'assurance constante porte sur le capital initial, l'assurance dégressive sur le capital restant dû.",
	);
	await dialog.getByRole("combobox", { name: "Type d'assurance" }).click();
	await expect(page.getByRole("option")).toHaveText(["Aucune", "Constante", "Dégressive"]);
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
	const details = page.getByRole("list", { name: "Détails du prêt" });
	await expect(details.getByRole("listitem")).toHaveText([
		`Emprunté : ${euros(13_000_000)}`,
		"Taux : 1,820 % fixe",
		"Durée : 25 ans",
	]);

	// What the header does not name still reached the server.
	await page.getByRole("button", { name: `Actions du compte ${name}` }).click();
	await page.getByRole("menuitem", { name: "Modifier" }).click();
	const edit = page.getByRole("dialog", { name: "Modifier le compte" });
	await expect(edit.getByLabel("Apport personnel")).toHaveValue("0,00");
	await expect(edit.getByLabel("Date d'origine")).toHaveValue("05/12/2020");
	await expect(edit.getByLabel("Taux d'assurance (%)")).toHaveValue("0,2917");
	await expect(edit.getByRole("combobox", { name: "Type d'assurance" })).toHaveText("Constante");
});

test("a loan's rate and term edited in the dialog show in its header", async ({ page, api }) => {
	const loan = await api.openAccount({
		name: uniqueName("Prêt"),
		kind: "consumer",
		openingBalance: "8 000,00",
		details: { interestRate: "4,9", termMonths: "30" },
	});

	await page.goto(`/accounts/${loan.id}`);
	const details = page.getByRole("list", { name: "Détails du prêt" });
	await expect(details.getByRole("listitem")).toHaveText(["Taux : 4,900 %", "Durée : 30 mois"]);
	await page.getByRole("button", { name: `Actions du compte ${loan.name}` }).click();
	await page.getByRole("menuitem", { name: "Modifier" }).click();
	const dialog = page.getByRole("dialog", { name: "Modifier le compte" });
	const rate = dialog.getByLabel("Taux d'intérêt (%)");
	await expect(rate).toHaveValue("4,90");
	await expect(dialog.getByLabel("Montant emprunté")).toHaveValue("");
	await rate.fill("1,8205");
	await dialog.getByLabel("Durée (mois)").fill("12,5");
	await dialog.getByRole("button", { name: "Enregistrer" }).click();
	await expect(rate).toHaveAccessibleDescription(
		"Taux invalide : entre 0 et 100, trois décimales au plus, quatre pour l'assurance.",
	);
	await expect(dialog.getByLabel("Durée (mois)")).toHaveAccessibleDescription(
		"Durée invalide : un nombre entier de mois, de 1 à 1 200.",
	);

	await rate.fill("3,75");
	await dialog.getByLabel("Durée (mois)").fill("48");
	await dialog.getByRole("button", { name: "Enregistrer" }).click();

	await expect(page.getByText(`Compte « ${loan.name} » enregistré.`)).toBeVisible();
	await expect(dialog).toBeHidden();
	// A rate typed without a rate type is fixed, as Sure's default.
	await expect(details.getByRole("listitem")).toHaveText(["Taux : 3,750 % fixe", "Durée : 4 ans"]);
	await page.reload();
	await expect(details.getByRole("listitem")).toHaveText(["Taux : 3,750 % fixe", "Durée : 4 ans"]);
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

	await page.goto(`/accounts/${loan.id}`);
	const details = page.getByRole("list", { name: "Détails du prêt" });
	await expect(details).toHaveText("Taux : 1,500 % variable");
	await page.getByRole("button", { name: `Actions du compte ${loan.name}` }).click();
	await page.getByRole("menuitem", { name: "Modifier" }).click();
	const dialog = page.getByRole("dialog", { name: "Modifier le compte" });
	const changes = dialog.getByRole("group", { name: "Changements de taux" });
	await expect(changes.getByLabel("Date d'effet du changement 1")).toHaveValue("05/06/2023");
	await expect(changes.getByLabel("Taux (%) du changement 1", { exact: true })).toHaveValue("2,00");

	// A row with a date and no rate is incomplete.
	await changes.getByRole("button", { name: "Ajouter un changement" }).click();
	await changes.getByLabel("Date d'effet du changement 2").fill("05/01/2025");
	await dialog.getByRole("button", { name: "Enregistrer" }).click();
	const refusal = dialog.getByText(
		"Chaque changement de taux demande une date et un taux entre 0 et 100, trois décimales au plus.",
	);
	await expect(refusal).toBeVisible();

	// Before origination, the start date.
	await changes.getByLabel("Date d'effet du changement 2").fill("05/01/2020");
	await changes.getByLabel("Taux (%) du changement 2", { exact: true }).fill("2,5");
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
	await expect(details).toHaveText("Taux : 1,500 % fixe");
	await page.getByRole("button", { name: `Actions du compte ${loan.name}` }).click();
	await page.getByRole("menuitem", { name: "Modifier" }).click();
	await expect(changes).toHaveCount(0);
	await dialog.getByRole("combobox", { name: "Type de taux" }).click();
	await page.getByRole("option", { name: "Révisable" }).click();
	await expect(changes.getByLabel("Date d'effet du changement 1")).toHaveValue("05/06/2023");
	await expect(changes.getByLabel("Date d'effet du changement 2")).toHaveValue("05/01/2025");
	await expect(changes.getByLabel("Taux (%) du changement 2", { exact: true })).toHaveValue("2,50");
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
	await expect(tabs.getByRole("tab")).toHaveText(["Opérations", "Soldes", "Échéancier", "Imports"]);
	await tabs.getByRole("tab", { name: "Échéancier" }).click();
	await expect(page).toHaveURL(/tab=schedule/u);

	const panel = page.getByRole("tabpanel", { name: "Échéancier" });
	await expect(panel.getByRole("group", { name: "Mensualité", exact: true })).toContainText(
		euros(53_969),
	);
	await expect(panel.getByRole("group", { name: "Intérêts totaux" })).toContainText(
		euros(3_190_696),
	);
	await expect(panel.getByRole("group", { name: "Coût total" })).toContainText(euros(16_190_696));
	await expect(panel.getByRole("group", { name: "Première mensualité" })).toHaveCount(0);
	await expect(
		panel.getByText(
			"Calculé à partir du montant emprunté, du taux et de la durée, depuis le 5 décembre 2020. Les remboursements anticipés n'y figurent pas.",
		),
	).toBeVisible();
	await expect(panel.getByText(/Le taux de ce prêt varie/u)).toHaveCount(0);

	const table = panel.getByRole("table", { name: "Échéancier" });
	await expect(table.getByRole("columnheader")).toHaveText([
		"N°",
		"Date",
		"Mensualité",
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
	await expect(panel.getByRole("group", { name: "Première mensualité" })).toContainText(
		euros(53_969),
	);
	await expect(panel.getByRole("group", { name: "Mensualité", exact: true })).toHaveCount(0);
	await expect(
		panel.getByText(
			"Le taux de ce prêt varie dans le temps. L'échéancier est recalculé à chaque changement enregistré : la date de fin reste la même et la mensualité est ajustée. Un changement pas encore enregistré modifiera ces chiffres.",
		),
	).toBeVisible();
});

test("a loan without an amount borrowed has no « Échéancier » tab, and a link to it opens « Opérations »", async ({
	page,
	api,
}) => {
	const loan = await api.openAccount({
		name: uniqueName("Prêt"),
		kind: "consumer",
		openingBalance: "8 000,00",
		details: { rateType: "fixed", interestRate: "4,9", termMonths: "30" },
	});

	await page.goto(`/accounts/${loan.id}?tab=schedule`);

	const tabs = page.getByRole("tablist", { name: "Vues du compte" });
	await expect(tabs.getByRole("tab", { name: "Opérations" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(tabs.getByRole("tab")).toHaveText(["Opérations", "Soldes", "Imports"]);
});

test("an account that is not a loan has no « Échéancier » tab, and a link to it opens « Opérations »", async ({
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

	await expect(
		column(page)
			.getByRole("group", { name: "Investissement" })
			.getByRole("link", { name: new RegExp(name) }),
	).toContainText(euros(2_500_000));
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
	await addAccount(page).click();

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
	await addAccount(page).click();

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
