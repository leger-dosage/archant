import type { Locator, Page } from "@playwright/test";

import type { AccountType } from "@archant/data/account-types";

import { expect } from "./fixtures.ts";

/** Sure's `accounts.types`, as the type list names each row. */
export const TYPE_NAMES = {
	depository: "Liquidités",
	investment: "Investissement",
	crypto: "Cryptomonnaie",
	property: "Bien immobilier",
	vehicle: "Véhicule",
	credit_card: "Carte de crédit",
	loan: "Prêt",
	other_asset: "Autre actif",
	other_liability: "Autre passif",
} as const satisfies Record<AccountType, string>;

// The types whose Sure view asks how to add them, written out here rather
// than read from the interface, so a wrong list there fails the tests.
const METHOD_STEP_TYPES: ReadonlySet<AccountType> = new Set([
	"depository",
	"investment",
	"crypto",
	"credit_card",
	"loan",
]);

/** The creation dialog, whichever step's title it bears: no other dialog is open beside it. */
export const creationDialog = (page: Page) => page.getByRole("dialog");

/** Clicks `opener` and waits for Sure's type list. */
export async function openTypeList(page: Page, opener: Locator): Promise<Locator> {
	await opener.click();
	const dialog = creationDialog(page);
	await expect(dialog.getByRole("heading", { name: "Que voulez-vous ajouter ?" })).toBeVisible();

	return dialog;
}

/**
 * Opens the creation dialog with `opener`, picks `type` and, where Sure asks
 * how, « Saisir le solde du compte »: the dialog on the type's form, or on a
 * property's « Vue d'ensemble ».
 */
export async function startAccount(
	page: Page,
	opener: Locator,
	type: AccountType,
): Promise<Locator> {
	const dialog = await openTypeList(page, opener);
	await dialog.getByRole("button", { name: TYPE_NAMES[type], exact: true }).click();

	if (METHOD_STEP_TYPES.has(type)) {
		await dialog.getByRole("button", { name: "Saisir le solde du compte" }).click();
	}

	return dialog;
}

/** Picks an option of the dialog's subtype select, Sure's « Type ». */
export async function chooseSubtype(page: Page, dialog: Locator, option: string): Promise<void> {
	await dialog.getByRole("combobox", { name: "Type", exact: true }).click();
	await page.getByRole("option", { name: option, exact: true }).click();
}
