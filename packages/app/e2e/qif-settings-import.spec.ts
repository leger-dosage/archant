import { expect, test, uniqueName } from "./fixtures.ts";

// Story 30.6: a Quicken file through Sure's `QifImport` steps. Its two
// accounts become Archant accounts, the category the user unchecks in
// « Configurer et sélectionner » is left out, and a split record lands as
// its split lines.

test("selects the categories of a QIF file, then imports its accounts and split lines", async ({
	page,
}) => {
	const checking = uniqueName("Courant QIF");
	const card = uniqueName("Carte QIF");
	const kept = uniqueName("Loisirs");
	const dropped = uniqueName("Divers");
	const food = uniqueName("Alimentation");
	const label = uniqueName("Supermarché");
	const fruits = uniqueName("Fruits");
	const coffee = uniqueName("Café");
	const file = [
		"!Account",
		`N${checking}`,
		"TBank",
		"^",
		"!Type:Bank",
		"D09/15'26",
		"T-100.00",
		`P${label}`,
		"L--Split--",
		`S${food}`,
		"$-60.00",
		`E${fruits}`,
		`S${kept}`,
		"$-40.00",
		"^",
		"D09/16'26",
		"T-12.50",
		`P${coffee}`,
		`L${dropped}`,
		"^",
		"!Account",
		`N${card}`,
		"TCCard",
		"^",
		"!Type:CCard",
		"D09/17'26",
		"T-30.00",
		"PLibrairie",
		`L${kept}/Vacances`,
		"^",
	].join("\n");

	await page.goto("/settings/imports");
	await page
		.getByRole("region", { name: "Sources" })
		.getByRole("link", { name: "Importer depuis Quicken (QIF)" })
		.click();
	await expect(page).toHaveURL(/\/settings\/imports\/qif$/u);
	await expect(
		page.getByRole("heading", { level: 1, name: "Téléverser le fichier QIF" }),
	).toBeVisible();
	await page.locator("#csv-import-file").setInputFiles({
		name: "quicken.qif",
		mimeType: "application/qif",
		buffer: Buffer.from(file),
	});
	await page.getByRole("button", { name: "Téléverser le QIF" }).click();

	await expect(
		page.getByRole("heading", { level: 1, name: "Configurer et sélectionner" }),
	).toBeVisible();
	await expect(page.getByRole("navigation", { name: "Étapes de l'importation" })).toContainText(
		"Sélectionner",
	);
	await expect(page.getByRole("combobox", { name: "Format de date" })).toHaveText("MM/DD/YYYY");
	await expect(page.getByText("Première date analysée : 2026-09-15")).toBeVisible();
	await expect(page.getByText("Transactions scindées détectées")).toBeVisible();
	await expect(page.getByText("3 catégories trouvées")).toBeVisible();

	const unchecked = page.getByRole("checkbox", { name: `Importer ${dropped}` });

	await expect(unchecked).toBeChecked();
	await unchecked.click();
	await expect(unchecked).not.toBeChecked();
	await page.getByRole("button", { name: "Continuer vers la revue" }).click();

	await expect(page.getByRole("heading", { level: 1, name: "Nettoyez vos données" })).toBeVisible();
	await expect(page.getByText("Vos données ont été nettoyées")).toBeVisible();
	await page.getByRole("button", { name: "Étape suivante" }).click();

	await expect(
		page.getByRole("heading", { level: 1, name: "Attribuez vos catégories" }),
	).toBeVisible();
	await page.getByRole("button", { name: "Suivant" }).click();
	await expect(
		page.getByRole("heading", { level: 1, name: "Attribuez vos étiquettes" }),
	).toBeVisible();
	await page.getByRole("button", { name: "Suivant" }).click();
	await expect(
		page.getByRole("heading", { level: 1, name: "Attribuez vos comptes" }),
	).toBeVisible();
	await page.getByRole("button", { name: "Suivant" }).click();

	await expect(
		page.getByRole("heading", { level: 1, name: "Confirmez vos données d'importation" }),
	).toBeVisible();
	await expect(page.getByRole("row", { name: "Opérations 3" })).toBeVisible();
	await expect(page.getByRole("row", { name: "Comptes 2" })).toBeVisible();
	await page.getByRole("button", { name: "Publier l'importation" }).click();
	await expect(page.getByRole("heading", { level: 1, name: "Importation réussie" })).toBeVisible();

	await page.goto(`/transactions?q=${encodeURIComponent(fruits)}`);
	const split = page
		.getByRole("list", { name: `Lignes de « ${label} »` })
		.getByRole("listitem")
		.filter({ hasText: fruits });

	await expect(split).toContainText(food);
	await expect(split).toContainText("−60,00");

	await page.goto(`/transactions?q=${encodeURIComponent(coffee)}`);
	const line = page.getByRole("main").getByRole("listitem").filter({ hasText: coffee });

	await expect(line).toContainText("−12,50");
	await expect(line).not.toContainText(dropped);
});
