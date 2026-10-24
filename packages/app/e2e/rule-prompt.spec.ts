import type { Api } from "./fixtures.ts";
import type { Page } from "@playwright/test";

import { daysAgo, expect, test, uniqueName } from "./fixtures.ts";

// Story 32.11: Sure's rule prompt after a category set by hand. One database
// and one administrator serve the whole run: « Masquer pour aujourd'hui »
// hides every prompt for the files that run after this one, and each test
// deletes its rules.

test.afterEach(async ({ api }) => {
	await api.deleteRules();
});

const rowItem = (page: Page, label: string) =>
	page.getByRole("main").getByRole("listitem").filter({ hasText: label });

const chipOf = (page: Page, label: string, name: string) =>
	rowItem(page, label).getByRole("button", { name: `Catégorie : ${name}`, exact: true });

const toast = (page: Page, text: string) =>
	page.locator("[data-sonner-toast]").filter({ hasText: text });

const prompt = (page: Page, category: string) => toast(page, `Catégorie changée en ${category}`);

const ruleDialog = (page: Page) => page.getByRole("dialog", { name: "Ajouter une règle" });

/** Sets a row's category from its chip, by name, once the server said whether to offer a rule. */
async function categorise(page: Page, label: string, category: string) {
	const asked = page.waitForResponse((response) => response.url().endsWith("/rule-prompt"));
	await chipOf(page, label, "Sans catégorie").first().click();
	await page.getByRole("combobox", { name: "Rechercher une catégorie" }).fill(category);
	await page.getByRole("option", { name: category, exact: true }).click();
	await expect(chipOf(page, label, category).first()).toBeVisible();
	await asked;
}

/** Lines of a fresh account, each labelled `<prefix> <suffix>`, and two categories of their own. */
async function lines(api: Api, suffixes: string[]) {
	const prefix = uniqueName("PRLV");
	const account = await api.openAccount();
	const labels = suffixes.map((suffix) => `${prefix} ${suffix}`);
	await labels.reduce(async (previous, label, index) => {
		await previous;
		await api.addTransaction(account.id, { date: daysAgo(index + 2), label, amount: "-12,00" });
	}, Promise.resolve());
	const first = await api.createCategory({ name: uniqueName("Abonnements") });
	const second = await api.createCategory({ name: uniqueName("Loisirs") });

	return { account, prefix, labels, first: first.name, second: second.name };
}

test("categorising a row offers a rule, whose form opens preset and, once confirmed, stops the offer", async ({
	page,
	api,
}) => {
	const { account, prefix, labels, first } = await lines(api, ["A"]);
	const [label = ""] = labels;
	await page.goto(`/transactions?q=${encodeURIComponent(prefix)}`);

	await categorise(page, label, first);
	await expect(prompt(page, first)).toContainText(
		"Vous pouvez créer une règle pour catégoriser automatiquement les opérations comme celle-ci",
	);
	await prompt(page, first).getByRole("button", { name: "Créer une règle" }).click();

	await expect(page).toHaveURL(/\/rules$/u);
	await expect(ruleDialog(page).getByRole("textbox", { name: "Nom" })).toHaveValue(label);
	await expect(ruleDialog(page).getByLabel("Champ de la condition 1")).toHaveText("Libellé");
	await expect(ruleDialog(page).getByLabel("Opérateur de la condition 1")).toHaveText("Contient");
	await expect(ruleDialog(page).getByLabel("Valeur de la condition 1")).toHaveValue(label);
	await expect(
		ruleDialog(page).getByRole("button", { name: "Catégorie", exact: true }),
	).toContainText(first);
	await ruleDialog(page).getByRole("button", { name: "Enregistrer" }).click();
	await page
		.getByRole("alertdialog")
		.getByRole("button", { name: "Confirmer les modifications" })
		.click();
	await expect(page.getByRole("alertdialog")).toBeHidden();

	// A line typed by hand meets rules at the next sync only: set by hand, the
	// enabled rule already matches it, so nothing is offered.
	await api.addTransaction(account.id, { date: daysAgo(1), label, amount: "-12,00" });
	await page.goto(`/transactions?q=${encodeURIComponent(prefix)}`);
	await categorise(page, label, first);
	await expect(toast(page, "Catégorie modifiée").first()).toBeVisible();
	await expect(prompt(page, first)).toHaveCount(0);
});

test("the sheet offers one too, the close button hides it, and « Annuler » on a row withdraws it", async ({
	page,
	api,
}) => {
	const { prefix, labels, first, second } = await lines(api, ["D", "E"]);
	const [one = "", other = ""] = labels;
	await page.goto(`/transactions?q=${encodeURIComponent(prefix)}`);

	await rowItem(page, one).locator("button[data-transaction-id]").click();
	const sheet = page.getByRole("dialog", { name: "Modifier l'opération" });
	await sheet.getByRole("button", { name: "Catégorie", exact: true }).click();
	await page.getByRole("combobox", { name: "Rechercher une catégorie" }).fill(first);
	await page.getByRole("option", { name: first, exact: true }).click();
	await sheet.getByRole("button", { name: "Enregistrer" }).click();
	await expect(sheet).toBeHidden();
	await prompt(page, first).getByRole("button", { name: "Fermer" }).click();
	await expect(prompt(page, first)).toHaveCount(0);

	await categorise(page, other, second);
	await expect(prompt(page, second)).toBeVisible();
	await toast(page, "Catégorie modifiée").getByRole("button", { name: "Annuler" }).click();
	await expect(chipOf(page, other, "Sans catégorie")).toBeVisible();
	await expect(prompt(page, second)).toHaveCount(0);
});

test("« Masquer pour aujourd'hui » hides the prompt, and the next one, for the day", async ({
	page,
	api,
}) => {
	const { prefix, labels, first, second } = await lines(api, ["B", "C"]);
	const [one = "", other = ""] = labels;
	await page.goto(`/transactions?q=${encodeURIComponent(prefix)}`);

	await categorise(page, one, first);
	await prompt(page, first).getByRole("button", { name: "Masquer pour aujourd'hui" }).click();
	await expect(prompt(page, first)).toHaveCount(0);

	await categorise(page, other, second);
	await expect(toast(page, "Catégorie modifiée").first()).toBeVisible();
	await expect(prompt(page, second)).toHaveCount(0);
});
