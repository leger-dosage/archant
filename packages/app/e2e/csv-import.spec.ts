import type { Page } from "@playwright/test";

import { expect, test, uniqueName } from "./fixtures.ts";

// Story 30.3: « Réglages › Importations » lists Sure's raw-data sources, and
// a categories file goes through « Téléverser », « Configurer » and
// « Confirmer » before its categories land.

function csv(lines: readonly string[]): { name: string; mimeType: string; buffer: Buffer } {
	return { name: "categories.csv", mimeType: "text/csv", buffer: Buffer.from(lines.join("\n")) };
}

async function openCategoriesImport(page: Page) {
	await page.goto("/settings/imports");
	await expect(page.getByRole("heading", { level: 1, name: "Importations" })).toBeVisible();
	const raw = page.getByRole("region", { name: "Données brutes" });

	await expect(raw.getByRole("listitem")).toHaveText([
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

test("names the line of a category its own parent and leaves nothing to publish", async ({
	page,
}) => {
	const name = uniqueName("Boucle");

	await openCategoriesImport(page);
	await page
		.locator("#csv-import-file")
		.setInputFiles(csv(["name,color,parent_category,lucide_icon", `${name},,${name},`]));
	await page.getByRole("button", { name: "Téléverser le CSV" }).click();
	await page.getByRole("button", { name: "Continuer" }).click();

	await expect(page.getByRole("alert")).toContainText(
		`Ligne 2 : la catégorie « ${name} » ne peut pas être son propre parent.`,
	);
	await expect(page.getByRole("button", { name: "Publier l'importation" })).toBeDisabled();
});
