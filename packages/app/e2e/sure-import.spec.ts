import type { Page } from "@playwright/test";

import { daysAgo, expect, test, uniqueName } from "./fixtures.ts";

// Story 30.1: « Réglages › Importations » reads the `all.ndjson` of a Sure
// or an Archant export, shows Sure's summary, then imports it.

function archive(lines: readonly unknown[]): { name: string; mimeType: string; buffer: Buffer } {
	return {
		name: "all.ndjson",
		mimeType: "application/x-ndjson",
		buffer: Buffer.from(lines.map((line) => JSON.stringify(line)).join("\n")),
	};
}

async function openSureImport(page: Page) {
	await page.goto("/settings/categories");
	await page
		.getByRole("navigation", { name: "Réglages" })
		.getByRole("link", { name: "Importations" })
		.click();
	await expect(page).toHaveURL(/\/settings\/imports$/u);
	await expect(page.getByRole("heading", { level: 1, name: "Importations" })).toBeVisible();
	await page.getByRole("link", { name: /Importer depuis Sure/u }).click();
	await expect(page).toHaveURL(/\/settings\/imports\/sure$/u);
	await expect(
		page.getByRole("heading", { level: 1, name: "Importer depuis l'export" }),
	).toBeVisible();
}

test("uploads an archive, reads Sure's summary, imports it and shows the new account", async ({
	api,
	page,
}) => {
	const name = uniqueName("Compte Sure");
	const category = uniqueName("Bricolage");
	// A name the household holds, which the import reuses.
	const existing = await api.createCategory({ name: uniqueName("Courses") });

	await openSureImport(page);
	await page.locator("#sure-import-file").setInputFiles({
		name: "all.ndjson",
		mimeType: "application/x-ndjson",
		buffer: Buffer.from("hello"),
	});
	await page.getByRole("button", { name: "Téléverser le NDJSON" }).click();
	await expect(page.getByRole("alert")).toHaveText(
		"Le fichier doit être un NDJSON valide avec au moins un enregistrement",
	);

	await page.locator("#sure-import-file").setInputFiles(
		archive([
			{
				type: "Account",
				data: {
					id: "a1",
					name,
					balance: "1500.00",
					currency: "EUR",
					accountable_type: "Depository",
					subtype: "checking",
				},
			},
			{
				type: "Category",
				data: { id: "c1", name: existing.name.toUpperCase(), classification: "expense" },
			},
			{ type: "Category", data: { id: "c2", name: category, classification: "expense" } },
			{
				type: "Transaction",
				data: {
					id: "t1",
					account_id: "a1",
					date: daysAgo(3),
					amount: "42.90",
					name: "BOULANGERIE",
					category_id: "c1",
				},
			},
			{
				type: "Transaction",
				data: { id: "t2", account_id: "a1", date: daysAgo(2), amount: "-100", name: "VIREMENT" },
			},
		]),
	);
	await page.getByRole("button", { name: "Téléverser le NDJSON" }).click();

	await expect(
		page.getByRole("heading", { level: 1, name: "Confirmer votre importation" }),
	).toBeVisible();
	const summary = page.getByRole("region", { name: "Résumé de l'importation" });
	await expect(summary.getByRole("listitem")).toHaveText([
		"Comptes1",
		"Catégories2",
		"Opérations2",
	]);
	await expect(
		page.getByText("Certaines catégories, étiquettes ou marchands existent déjà"),
	).toBeVisible();

	await page.getByRole("button", { name: "Démarrer l'importation" }).click();
	await expect(page.getByRole("heading", { level: 1, name: "Importation réussie" })).toBeVisible();
	await page.getByRole("link", { name: "Retour au tableau de bord" }).click();
	await expect(page).toHaveURL(/\/$/u);
	await expect(page.getByRole("link", { name: new RegExp(name, "u") }).first()).toBeVisible();
});

test("names the line of a missing reference and leaves nothing to start", async ({ page }) => {
	await openSureImport(page);
	await page.locator("#sure-import-file").setInputFiles(
		archive([
			{
				type: "Account",
				data: {
					id: "a1",
					name: uniqueName("Jamais importé"),
					balance: "0",
					accountable_type: "Depository",
				},
			},
			{ type: "Transaction", data: { id: "t1", account_id: "x", date: daysAgo(1), amount: "5" } },
		]),
	);
	await page.getByRole("button", { name: "Téléverser le NDJSON" }).click();

	await expect(page.getByRole("alert")).toContainText(
		'Ligne 2 : Transaction référence un account_id manquant ("x").',
	);
	await expect(page.getByRole("button", { name: "Démarrer l'importation" })).toBeDisabled();
	await page.getByRole("button", { name: "Annuler" }).click();
	await expect(
		page.getByRole("heading", { level: 1, name: "Importer depuis l'export" }),
	).toBeVisible();
});
