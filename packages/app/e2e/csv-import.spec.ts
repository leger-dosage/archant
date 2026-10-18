import type { Page } from "@playwright/test";

import { expect, test, uniqueName } from "./fixtures.ts";

// Story 30.3: « Réglages › Importations » lists Sure's raw-data sources, and
// a categories file goes through « Téléverser », « Configurer » and
// « Confirmer » before its categories land. Story 30.4: a transactions file
// skips its preamble, signs its lines from a type column and maps its
// categories before its lines land. Story 30.2: a YNAB file, its columns
// preset, lands in a new account under a new category. Story 30.5: every
// file goes through « Nettoyer », where an invalid cell is fixed in place.

function csv(lines: readonly string[]): { name: string; mimeType: string; buffer: Buffer } {
	return { name: "categories.csv", mimeType: "text/csv", buffer: Buffer.from(lines.join("\n")) };
}

/** « Nettoyer » with every row valid: on to the next step. */
async function passClean(page: Page) {
	await expect(page.getByRole("heading", { level: 1, name: "Nettoyez vos données" })).toBeVisible();
	await expect(page.getByText("Vos données ont été nettoyées")).toBeVisible();
	await page.getByRole("button", { name: "Étape suivante" }).click();
}

async function openCategoriesImport(page: Page) {
	await page.goto("/settings/imports");
	await expect(page.getByRole("heading", { level: 1, name: "Importations" })).toBeVisible();
	const raw = page.getByRole("region", { name: "Données brutes" });

	await expect(raw.getByRole("listitem")).toHaveText([
		/Importer les opérations/u,
		/Importer les investissements/u,
		/Importer les comptes/u,
		/Importer les catégories/u,
		/Importer des marchands/u,
		/Importer les règles/u,
	]);

	await raw.getByRole("link", { name: "Importer les catégories" }).click();
	await expect(page).toHaveURL(/\/settings\/imports\/categories$/u);
	await expect(page.getByRole("heading", { level: 1, name: "Importez vos données" })).toBeVisible();
}

test("imports a categories file and finds the category under its parent", async ({ page }) => {
	const parent = uniqueName("Maison");
	const child = uniqueName("Jardin");

	await openCategoriesImport(page);
	await page
		.locator("#csv-import-file")
		.setInputFiles(
			csv([
				"name*,color,parent_category,lucide_icon",
				`${parent},#27a644,,house`,
				`${child},,${parent},wrench`,
			]),
		);
	await page.getByRole("button", { name: "Téléverser le CSV" }).click();

	await expect(
		page.getByRole("heading", { level: 1, name: "Configurez votre importation" }),
	).toBeVisible();
	await expect(page.getByRole("cell", { name: child })).toBeVisible();
	await page.getByRole("button", { name: "Continuer" }).click();
	await passClean(page);

	await expect(
		page.getByRole("heading", { level: 1, name: "Confirmez vos données d'importation" }),
	).toBeVisible();
	await expect(page.getByRole("row", { name: "Catégories 2" })).toBeVisible();
	await page.getByRole("button", { name: "Publier l'importation" }).click();

	await expect(page.getByRole("heading", { level: 1, name: "Importation réussie" })).toBeVisible();
	await page.goto("/settings/categories");
	await expect(page.getByText(child, { exact: true })).toBeVisible();
	await expect(page.getByText(parent, { exact: true })).toBeVisible();
});

test("names the line of a category its own parent in « Nettoyer » and goes no further", async ({
	page,
}) => {
	const name = uniqueName("Boucle");

	await openCategoriesImport(page);
	await page
		.locator("#csv-import-file")
		.setInputFiles(csv(["name,color,parent_category,lucide_icon", `${name},,${name},`]));
	await page.getByRole("button", { name: "Téléverser le CSV" }).click();
	await page.getByRole("button", { name: "Continuer" }).click();

	await expect(page.getByRole("heading", { level: 1, name: "Nettoyez vos données" })).toBeVisible();
	await expect(page.getByLabel("Catégorie parente, ligne 2")).toHaveAccessibleDescription(
		`Ligne 2 : la catégorie « ${name} » ne peut pas être son propre parent.`,
	);
	await expect(page.getByRole("button", { name: "Étape suivante" })).toBeDisabled();
});

test("imports a transactions file into an account, its category mapped to a new one", async ({
	page,
	api,
}) => {
	const { name: accountName } = await api.openAccount();
	const category = uniqueName("Boulangeries");
	const label = uniqueName("Pain");

	await page.goto("/settings/imports");
	await page
		.getByRole("region", { name: "Données brutes" })
		.getByRole("link", { name: "Importer les opérations" })
		.click();
	await expect(page).toHaveURL(/\/settings\/imports\/transactions$/u);
	await page.getByLabel("Compte (facultatif)").click();
	await page.getByRole("option", { name: accountName }).click();
	await page.locator("#csv-import-file").setInputFiles({
		name: "releve.csv",
		mimeType: "text/csv",
		buffer: Buffer.from(
			[
				"Relevé du compte",
				"Date,Montant,Sens,Libellé,Catégorie",
				`15/09/2026,4.20,Débit,${label},${category}`,
			].join("\n"),
		),
	});
	await page.getByRole("button", { name: "Téléverser le CSV" }).click();

	await expect(
		page.getByRole("heading", { level: 1, name: "Configurez votre importation" }),
	).toBeVisible();
	await expect(page.getByRole("button", { name: "Appliquer la configuration" })).toBeDisabled();

	const choose = async (field: string, column: string) => {
		await page.getByLabel(field, { exact: true }).click();
		await page.getByRole("option", { name: column, exact: true }).click();
	};

	// The bank's preamble line is skipped, and the file read again with its headers.
	await page.getByLabel("Ignorer les n premières lignes").fill("1");
	await page.getByLabel("Ignorer les n premières lignes").press("Enter");
	await expect(page.getByRole("cell", { name: label })).toBeVisible();
	await choose("Date", "Date");
	await choose("Montant", "Montant");
	// The sign comes from the « Sens » column, Sure's custom column.
	await choose("Stratégie de type de montant", "Colonne personnalisée");
	await choose("Colonne de type de montant", "Sens");
	await choose("Valeur d'identifiant", "Débit");
	await choose("Traiter « Débit » comme", "Dépense (sortie)");
	await choose("Nom", "Libellé");
	await choose("Catégorie", "Catégorie");

	await expect(page.getByLabel("Format de date")).toHaveText("DD/MM/YYYY");
	await page.getByRole("button", { name: "Appliquer la configuration" }).click();
	await passClean(page);

	await expect(
		page.getByRole("heading", { level: 1, name: "Attribuez vos catégories" }),
	).toBeVisible();
	await expect(page.getByLabel("Catégorie dans Archant")).toHaveText(
		"Ajouter comme nouvelle catégorie",
	);
	await page.getByRole("button", { name: "Suivant" }).click();
	await expect(
		page.getByRole("heading", { level: 1, name: "Attribuez vos étiquettes" }),
	).toBeVisible();
	await page.getByRole("button", { name: "Suivant" }).click();

	await expect(
		page.getByRole("heading", { level: 1, name: "Confirmez vos données d'importation" }),
	).toBeVisible();
	await expect(page.getByRole("row", { name: "Opérations 1" })).toBeVisible();
	await expect(page.getByRole("row", { name: "Catégories 1" })).toBeVisible();
	await page.getByRole("button", { name: "Publier l'importation" }).click();
	await expect(page.getByRole("heading", { level: 1, name: "Importation réussie" })).toBeVisible();

	await page.goto(`/transactions?q=${encodeURIComponent(label)}`);
	const row = page.getByRole("main").getByRole("listitem").filter({ hasText: label });

	await expect(row).toContainText(category);
	await expect(row).toContainText("−4,20");
});

test("imports a YNAB file with its columns preset, into a new account and category", async ({
	page,
}) => {
	const accountName = uniqueName("Carte YNAB");
	const group = uniqueName("Sorties");
	const category = uniqueName("Cafés");
	const payee = uniqueName("Coffee Shop");

	await page.goto("/settings/imports");
	const sources = page.getByRole("region", { name: "Sources" });

	await expect(sources.getByRole("listitem")).toHaveText([
		/Importer depuis Sure/u,
		/Importer depuis Mint/u,
		/Importer depuis Actual/u,
		/Importer depuis Quicken \(QIF\)/u,
		/Importer depuis YNAB/u,
	]);
	await sources.getByRole("link", { name: "Importer depuis YNAB" }).click();
	await expect(page).toHaveURL(/\/settings\/imports\/ynab$/u);
	await expect(page.getByLabel("Compte (facultatif)")).toHaveCount(0);
	await page.locator("#csv-import-file").setInputFiles({
		name: "ynab.csv",
		mimeType: "text/csv",
		buffer: Buffer.from(
			[
				"Account,Flag,Date,Payee,Category Group/Category,Category Group,Category,Memo,Outflow,Inflow,Cleared",
				`${accountName},,09/15/2026,${payee},${group}: ${category},${group},${category},,$4.20,$0.00,Cleared`,
			].join("\n"),
		),
	});
	await page.getByRole("button", { name: "Téléverser le CSV" }).click();

	await expect(
		page.getByRole("heading", { level: 1, name: "Configurez votre importation" }),
	).toBeVisible();
	await expect(
		page.getByText("Nous avons préconfiguré votre importation YNAB pour vous."),
	).toBeVisible();
	await expect(page.getByLabel("Bénéficiaire (facultatif)")).toHaveText("Payee");
	await expect(page.getByLabel("Format de date")).toHaveText("MM/DD/YYYY");
	await page.getByRole("button", { name: "Appliquer la configuration" }).click();
	await passClean(page);

	await expect(
		page.getByRole("heading", { level: 1, name: "Attribuez vos catégories" }),
	).toBeVisible();
	await expect(page.getByLabel("Catégorie dans Archant")).toHaveText(
		"Ajouter comme nouvelle catégorie",
	);
	await page.getByRole("button", { name: "Suivant" }).click();
	await expect(
		page.getByRole("heading", { level: 1, name: "Attribuez vos comptes" }),
	).toBeVisible();
	await expect(page.getByLabel("Compte dans Archant")).toHaveText("Ajouter comme nouveau compte");
	await page.getByRole("button", { name: "Suivant" }).click();

	await expect(
		page.getByRole("heading", { level: 1, name: "Confirmez vos données d'importation" }),
	).toBeVisible();
	await expect(page.getByRole("row", { name: "Opérations 1" })).toBeVisible();
	await expect(page.getByRole("row", { name: "Comptes 1" })).toBeVisible();
	await page.getByRole("button", { name: "Publier l'importation" }).click();
	await expect(page.getByRole("heading", { level: 1, name: "Importation réussie" })).toBeVisible();

	await page.goto(`/transactions?q=${encodeURIComponent(payee)}`);
	const row = page.getByRole("main").getByRole("listitem").filter({ hasText: payee });

	await expect(row).toContainText(category);
	await expect(row).toContainText(accountName);
	await expect(row).toContainText("−4,20");
});

test("fixes an invalid date in « Nettoyer », then publishes the line", async ({ page, api }) => {
	const { name: accountName } = await api.openAccount();
	const label = uniqueName("Cinéma");

	await page.goto("/settings/imports/transactions");
	await page.getByLabel("Compte (facultatif)").click();
	await page.getByRole("option", { name: accountName }).click();
	await page.locator("#csv-import-file").setInputFiles({
		name: "releve.csv",
		mimeType: "text/csv",
		buffer: Buffer.from(
			["Date,Montant,Libellé", "02/09/2026,-4.20,Boulangerie", `31/02/2026,-12.00,${label}`].join(
				"\n",
			),
		),
	});
	await page.getByRole("button", { name: "Téléverser le CSV" }).click();

	const choose = async (field: string, column: string) => {
		await page.getByLabel(field, { exact: true }).click();
		await page.getByRole("option", { name: column, exact: true }).click();
	};

	await choose("Date", "Date");
	await choose("Montant", "Montant");
	await choose("Nom", "Libellé");
	await expect(page.getByLabel("Format de date")).toHaveText("DD/MM/YYYY");
	await page.getByRole("button", { name: "Appliquer la configuration" }).click();

	await expect(page.getByRole("heading", { level: 1, name: "Nettoyez vos données" })).toBeVisible();
	const date = page.getByLabel("Date, ligne 3");

	await expect(date).toHaveAttribute("aria-invalid", "true");
	await expect(date).toHaveAccessibleDescription(
		"Ligne 3 : la date doit suivre exactement le format DD/MM/YYYY.",
	);
	await expect(page.getByRole("button", { name: "Étape suivante" })).toBeDisabled();

	await page.getByRole("button", { name: "Lignes d'erreur" }).click();
	await expect(page.getByLabel(/^Date, ligne/u)).toHaveCount(1);

	await date.fill("28/02/2026");
	await date.press("Tab");
	await expect(page.getByText("Vos données ont été nettoyées")).toBeVisible();
	await expect(page.getByLabel("Date, ligne 3")).toHaveValue("28/02/2026");
	await expect(page.getByLabel("Date, ligne 3")).toHaveAttribute("aria-invalid", "false");
	await page.getByRole("button", { name: "Étape suivante" }).click();

	await expect(
		page.getByRole("heading", { level: 1, name: "Attribuez vos catégories" }),
	).toBeVisible();
	await page.getByRole("button", { name: "Suivant" }).click();
	await page.getByRole("button", { name: "Suivant" }).click();

	await expect(
		page.getByRole("heading", { level: 1, name: "Confirmez vos données d'importation" }),
	).toBeVisible();
	await expect(page.getByRole("row", { name: "Opérations 2" })).toBeVisible();
	await page.getByRole("button", { name: "Publier l'importation" }).click();
	await expect(page.getByRole("heading", { level: 1, name: "Importation réussie" })).toBeVisible();

	await page.goto(`/transactions?q=${encodeURIComponent(label)}`);
	const row = page.getByRole("main").getByRole("listitem").filter({ hasText: label });

	await expect(row).toContainText("−12,00");

	// The line is published on the corrected day, read back through the API.
	const listed = await page.request.get(`/api/transactions?q=${encodeURIComponent(label)}`);

	expect(JSON.stringify(await listed.json())).toContain('"2026-02-28"');
});
