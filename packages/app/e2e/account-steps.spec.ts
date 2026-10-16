import type { Page } from "@playwright/test";

import { euros, expect, test, uniqueName } from "./fixtures.ts";
import { TYPE_NAMES, chooseSubtype, openTypeList, startAccount } from "./new-account.ts";

// Story 28.16: Sure's account creation in its steps, `accounts/new`, its
// method selector, then the type's own form; a property in three tabs.

/** The page's own « Ajouter un compte »: the accounts column holds another. */
const addAccount = (page: Page) =>
	page.getByRole("main").getByRole("button", { name: "Ajouter un compte" });

const assetRow = (page: Page, name: string) =>
	page.getByRole("region", { name: "Actifs" }).getByRole("link", { name: new RegExp(name, "u") });

test("the type list names Sure's types in its order, with the arrow keys and j/k between them", async ({
	page,
}) => {
	await page.goto("/accounts");
	const dialog = await openTypeList(page, addAccount(page));

	const rows = dialog.locator("[data-choice]");
	await expect(rows).toHaveText(Object.values(TYPE_NAMES));
	await expect(rows.first().locator('[data-slot="tinted-icon"]')).toBeVisible();
	await expect(rows.first()).toBeFocused();
	await page.keyboard.press("ArrowDown");
	await expect(rows.nth(1)).toBeFocused();
	await page.keyboard.press("j");
	await expect(rows.nth(2)).toBeFocused();
	await page.keyboard.press("k");
	await page.keyboard.press("ArrowUp");
	await expect(rows.first()).toBeFocused();
	// Sure's ← and → too; from a control that is not a row, ↓ goes to the first row.
	await page.keyboard.press("ArrowRight");
	await expect(rows.nth(1)).toBeFocused();
	await page.keyboard.press("ArrowLeft");
	await expect(rows.first()).toBeFocused();
	await dialog.locator('[data-slot="dialog-close"]').focus();
	await page.keyboard.press("ArrowDown");
	await expect(rows.first()).toBeFocused();
	await page.keyboard.press("Control+j");
	await expect(rows.first()).toBeFocused();
	// Sure's footer, from `md` up.
	await expect(dialog.getByText("Sélectionnez")).toBeVisible();
	await expect(dialog.getByText("Naviguer")).toBeVisible();
	await expect(dialog.getByText("ESC")).toBeVisible();

	// Enter picks the focused row, as Sure's links.
	await page.keyboard.press("Enter");
	await expect(
		dialog.getByRole("heading", { name: "Comment voulez-vous l'ajouter ?" }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
});

test("the method step offers the bank link for a depository, not for an investment, and goes back to the types", async ({
	page,
}) => {
	await page.goto("/accounts");
	const dialog = await openTypeList(page, addAccount(page));

	await dialog.getByRole("button", { name: "Investissement", exact: true }).click();
	await expect(
		dialog.getByRole("heading", { name: "Comment voulez-vous l'ajouter ?" }),
	).toBeVisible();
	await expect(dialog.locator("[data-choice]")).toHaveText(["Saisir le solde du compte"]);

	await dialog.getByRole("button", { name: "Retour" }).click();
	await expect(dialog.getByRole("heading", { name: "Que voulez-vous ajouter ?" })).toBeVisible();

	await dialog.getByRole("button", { name: "Liquidités", exact: true }).click();
	await expect(dialog.locator("[data-choice]")).toHaveText([
		"Saisir le solde du compte",
		"Lier avec Enable Banking",
	]);
	await dialog.getByRole("button", { name: "Lier avec Enable Banking" }).click();
	await expect(dialog).toBeHidden();
	await expect(page).toHaveURL(/\/settings\/banks$/u);
});

test("a vehicle opens its form at once, and its back arrow returns to the types", async ({
	page,
}) => {
	await page.goto("/accounts");
	const dialog = await openTypeList(page, addAccount(page));

	await dialog.getByRole("button", { name: "Véhicule", exact: true }).click();
	await expect(
		dialog.getByRole("heading", { name: "Saisir les détails du véhicule" }),
	).toBeVisible();
	await expect(dialog.getByLabel("Nom du compte")).toBeFocused();
	await dialog.getByRole("button", { name: "Retour" }).click();
	await expect(dialog.getByRole("heading", { name: "Que voulez-vous ajouter ?" })).toBeVisible();
});

test("a depository created through the steps has no subtype and reads « Liquidités »; going back keeps what was typed", async ({
	page,
}) => {
	const name = uniqueName("Compte joint");

	await page.goto("/accounts");
	const dialog = await startAccount(page, addAccount(page), "depository");
	await expect(dialog.getByRole("heading", { name: "Saisir le solde du compte" })).toBeVisible();
	// Sure's `accounts/_form` order: name, balance, opening date, then the type's own fields.
	const ids = await dialog
		.locator("form")
		.locator("input:not([type=hidden]), [role=combobox]")
		.evaluateAll((fields) => fields.map((field) => field.id));
	expect(ids.slice(0, 5)).toEqual(["name", "currency", "openingBalance", "openingDate", "subtype"]);
	await dialog.getByLabel("Nom du compte").fill(name);

	await dialog.getByRole("button", { name: "Retour" }).click();
	await dialog.getByRole("button", { name: "Saisir le solde du compte" }).click();
	await expect(dialog.getByLabel("Nom du compte")).toHaveValue(name);

	await dialog.getByLabel("Solde à la date :").fill("640,00");
	await dialog.getByRole("button", { name: "Ajouter le compte" }).click();
	await expect(dialog).toBeHidden();

	const row = assetRow(page, name);
	await expect(row.getByText("Liquidités", { exact: true })).toBeVisible();
	await expect(row).toContainText(euros(64_000));
	await expect(row).not.toContainText("Exclu des rapports");
});

test("choosing a type again starts its values afresh", async ({ page }) => {
	await page.goto("/accounts");
	const dialog = await startAccount(page, addAccount(page), "vehicle");
	await dialog.getByLabel("Nom du compte").fill("Brouillon");
	await dialog.getByRole("button", { name: "Retour" }).click();
	await dialog.getByRole("button", { name: "Véhicule", exact: true }).click();
	await expect(dialog.getByLabel("Nom du compte")).toHaveValue("");
});

test("a credit card created through the steps, excluded from reports by its switch", async ({
	page,
}) => {
	const name = uniqueName("Carte");

	await page.goto("/accounts");
	const dialog = await startAccount(page, addAccount(page), "credit_card");
	await expect(
		dialog.getByRole("heading", { name: "Saisir les détails de la carte de crédit" }),
	).toBeVisible();
	await dialog.getByLabel("Nom du compte").fill(name);
	await dialog.getByLabel("Solde à la date :").fill("320,00");
	await dialog.getByLabel("Crédit disponible").fill("2 000");
	await dialog.getByText("Détails supplémentaires").click();
	await dialog.getByRole("switch", { name: "Exclure des rapports" }).click();
	await dialog.getByRole("button", { name: "Ajouter le compte" }).click();
	await expect(dialog).toBeHidden();

	const row = page
		.getByRole("region", { name: "Passifs" })
		.getByRole("link", { name: new RegExp(name, "u") });
	await expect(row).toContainText("Exclu des rapports");
});

test("a loan without a subtype is refused before anything is sent", async ({ page }) => {
	let posted = false;
	page.on("request", (request) => {
		if (request.method() === "POST" && request.url().endsWith("/api/accounts")) {
			posted = true;
		}
	});

	await page.goto("/accounts");
	const dialog = await startAccount(page, addAccount(page), "loan");
	await dialog.getByLabel("Nom du compte").fill(uniqueName("Prêt"));
	await dialog.getByLabel("Solde à la date :").fill("10 000,00");
	await dialog.getByRole("button", { name: "Ajouter le compte" }).click();

	await expect(
		dialog.getByRole("combobox", { name: "Type", exact: true }),
	).toHaveAccessibleDescription("Ce champ est obligatoire.");
	expect(posted).toBe(false);
	await chooseSubtype(page, dialog, "Prêt étudiant");
	await dialog.getByRole("button", { name: "Ajouter le compte" }).click();
	await expect(dialog).toBeHidden();
});

test("a property walks « Vue d'ensemble », « Valeur » and « Adresse », each checked before the next", async ({
	page,
}) => {
	const name = uniqueName("Maison de campagne");

	await page.goto("/accounts");
	const dialog = await startAccount(page, addAccount(page), "property");
	const steps = dialog.getByRole("navigation", { name: "Étapes" });
	await expect(
		dialog.getByRole("heading", { name: "Saisir les détails de la propriété" }),
	).toBeVisible();
	await expect(steps.getByRole("listitem")).toHaveText(["Vue d'ensemble", "Valeur", "Adresse"]);
	await expect(steps.locator('[aria-current="step"]')).toHaveText("Vue d'ensemble");
	await expect(dialog.getByRole("combobox", { name: "Type de propriété" })).toHaveText(
		"Sélectionnez le type",
	);

	// « Suivant » checks the step's own fields.
	await dialog.getByRole("button", { name: "Suivant" }).click();
	await expect(dialog.getByLabel("Nom", { exact: true })).toHaveAccessibleDescription(
		"Ce champ est obligatoire.",
	);
	await expect(
		dialog.getByRole("combobox", { name: "Type de propriété" }),
	).toHaveAccessibleDescription("Ce champ est obligatoire.");
	await expect(steps.locator('[aria-current="step"]')).toHaveText("Vue d'ensemble");

	await dialog.getByLabel("Nom", { exact: true }).fill(name);
	await dialog.getByRole("combobox", { name: "Type de propriété" }).click();
	await page.getByRole("option", { name: "Maison", exact: true }).click();
	await dialog.getByLabel("Surface habitable").fill("120");
	await dialog.getByRole("button", { name: "Suivant" }).click();

	await expect(
		dialog.getByRole("heading", { name: "Saisir la propriété manuellement" }),
	).toBeVisible();
	await expect(steps.locator('[aria-current="step"]')).toHaveText("Valeur");
	await dialog.getByLabel("Valeur marchande estimée").fill("douze");
	await dialog.getByRole("button", { name: "Suivant" }).click();
	await expect(dialog.getByLabel("Valeur marchande estimée")).toHaveAccessibleDescription(
		"Montant invalide. Exemple : 1 234,56.",
	);

	// An earlier step opens again, what was typed kept.
	await steps.getByRole("button", { name: "Vue d'ensemble" }).click();
	await expect(dialog.getByLabel("Nom", { exact: true })).toHaveValue(name);
	await dialog.getByRole("button", { name: "Suivant" }).click();

	await dialog.getByLabel("Valeur marchande estimée").fill("410 000,00");
	await dialog.getByRole("button", { name: "Suivant" }).click();
	await expect(steps.locator('[aria-current="step"]')).toHaveText("Adresse");
	await dialog.getByLabel("Ville").fill("Annecy");
	await dialog.getByRole("button", { name: "Ajouter le compte" }).click();
	await expect(dialog).toBeHidden();

	const row = assetRow(page, name);
	await expect(row.getByText("Maison", { exact: true })).toBeVisible();
	await expect(row).toContainText(euros(41_000_000));
});

test("a refusal from the API on « Adresse » opens the step holding the refused field", async ({
	page,
}) => {
	// The dialog checks the value with the API's own schema, so only a
	// refusal from the API itself reaches « Adresse » with it.
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
					fields: [{ path: "openingBalance", code: "invalid_amount" }],
				},
			},
		});
	});

	await page.goto("/accounts");
	const dialog = await startAccount(page, addAccount(page), "property");
	await dialog.getByLabel("Nom", { exact: true }).fill(uniqueName("Refusée"));
	await dialog.getByRole("combobox", { name: "Type de propriété" }).click();
	await page.getByRole("option", { name: "Appartement", exact: true }).click();
	await dialog.getByRole("button", { name: "Suivant" }).click();
	await dialog.getByLabel("Valeur marchande estimée").fill("200 000,00");
	await dialog.getByRole("button", { name: "Suivant" }).click();
	await dialog.getByRole("button", { name: "Ajouter le compte" }).click();

	const steps = dialog.getByRole("navigation", { name: "Étapes" });
	await expect(steps.locator('[aria-current="step"]')).toHaveText("Valeur");
	await expect(dialog.getByLabel("Valeur marchande estimée")).toHaveAccessibleDescription(
		"Montant invalide. Exemple : 1 234,56.",
	);
	await expect(dialog.getByLabel("Valeur marchande estimée")).toBeFocused();
});
