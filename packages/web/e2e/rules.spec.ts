import type { Page } from "@playwright/test";

import { daysAgo, expect, test, uniqueName } from "./fixtures.ts";

// Story 8.1: categorisation rules at `/regles`. One database serves the whole
// run, and a rule reaches every transaction added after it, so each test
// deletes its rules before the next one starts.

test.afterEach(async ({ api }) => {
	await api.deleteRules();
});

const PAGE = "/regles";

const rulesList = (page: Page) => page.getByRole("list", { name: "Règles" });

const ruleRow = (page: Page, text: string) =>
	rulesList(page).getByRole("listitem").filter({ hasText: text });

// Named: the category combobox's popover is a dialog too.
const dialog = (page: Page) =>
	page.getByRole("dialog", { name: /^(Ajouter une|Modifier la) règle$/u });

const labelLike = (value: string) => ({
	conditionType: "transaction_name",
	operator: "like",
	value,
});

/** A transaction's category chip on `/operations`, narrowed to its label. */
async function expectCategory(page: Page, label: string, category: string) {
	await page.goto(`/operations?q=${encodeURIComponent(label)}`);
	await expect(
		page
			.getByRole("main")
			.getByRole("listitem")
			.filter({ hasText: label })
			.getByRole("button", { name: `Catégorie : ${category}`, exact: true }),
	).toBeVisible();
}

async function visit(page: Page) {
	await page.goto(PAGE);
	await expect(page.getByRole("heading", { level: 1, name: "Règles" })).toBeVisible();
}

test("the sidebar and g u open Règles, empty at first", async ({ page }) => {
	await page.goto("/comptes");
	await page
		.locator('[data-sidebar="sidebar"]')
		.getByRole("link", { name: "Règles", exact: true })
		.click();

	await expect(page).toHaveURL(/\/regles$/u);
	await expect(page.getByText("Aucune règle pour l'instant.")).toBeVisible();
	await expect(page.getByRole("button", { name: "Ajouter une règle" })).toBeVisible();

	await page.goto("/comptes");
	await expect(page.getByRole("heading", { level: 1, name: "Comptes" })).toBeVisible();
	await page.keyboard.press("g");
	await page.keyboard.press("u");
	await expect(page.getByRole("heading", { level: 1, name: "Règles" })).toBeVisible();
});

test("a rule saved from the form categorises the next matching transaction", async ({
	page,
	api,
}) => {
	const account = await api.openAccount();
	await visit(page);

	await page.getByRole("button", { name: "Ajouter une règle" }).click();
	await dialog(page).getByLabel("Valeur de la condition 1").fill("carrefour");
	await dialog(page).getByRole("button", { name: "Catégorie", exact: true }).click();
	await page.getByRole("option", { name: "Courses", exact: true }).click();
	await dialog(page).getByRole("button", { name: "Enregistrer" }).click();

	await expect(dialog(page)).toBeHidden();
	const row = ruleRow(page, "Si Libellé contient carrefour, alors Catégorie Courses");
	await expect(row).toBeVisible();
	await expect(row.getByRole("switch")).toBeChecked();

	const label = uniqueName("CB CARREFOUR");
	await api.addTransaction(account.id, { date: daysAgo(2), label, amount: "-42,90" });
	await expectCategory(page, label, "Courses");
});

test("the list sums up the other conditions and shows a rule's name", async ({ page, api }) => {
	const category = await api.createCategory();
	await api.createRule({
		conditions: [labelLike("boulangerie"), labelLike("paul"), labelLike("croissant")],
		categoryId: category.id,
	});
	const name = uniqueName("Loyer");
	await api.createRule({ name, conditions: [labelLike("loyer")], categoryId: category.id });

	await visit(page);

	await expect(ruleRow(page, "Si Libellé contient boulangerie")).toContainText(
		/, et 2 autres conditions$/u,
	);
	await expect(ruleRow(page, name)).toBeVisible();
});

test("a rule switched off leaves a matching transaction « Sans catégorie »", async ({
	page,
	api,
}) => {
	const account = await api.openAccount();
	const category = await api.createCategory();
	const marker = uniqueName("PRLV").replace(" ", "-");
	await api.createRule({
		conditions: [{ conditionType: "transaction_name", operator: "like", value: marker }],
		categoryId: category.id,
	});
	await visit(page);

	const toggle = ruleRow(page, marker).getByRole("switch");
	await toggle.click();
	await expect(toggle).not.toBeChecked();
	await expect(
		page.locator("[data-sonner-toast]").filter({ hasText: "Règle désactivée." }),
	).toBeVisible();

	const label = `${marker} EDF`;
	await api.addTransaction(account.id, { date: daysAgo(2), label, amount: "-60,00" });
	await expectCategory(page, label, "Sans catégorie");
});

test("« Modifier » reopens the form filled in and saves, « Supprimer » removes the rule once confirmed", async ({
	page,
	api,
}) => {
	const category = await api.createCategory();
	const before = uniqueName("avant");
	const after = uniqueName("après");
	await api.createRule({
		conditions: [{ conditionType: "transaction_name", operator: "like", value: before }],
		categoryId: category.id,
	});
	await visit(page);

	await ruleRow(page, before)
		.getByRole("button", { name: /^Actions pour / })
		.click();
	await page.getByRole("menuitem", { name: "Modifier" }).click();
	const value = dialog(page).getByLabel("Valeur de la condition 1");
	await expect(value).toHaveValue(before);
	await expect(dialog(page).getByRole("button", { name: "Catégorie", exact: true })).toContainText(
		category.name,
	);
	await value.fill(after);
	await dialog(page).getByRole("button", { name: "Enregistrer" }).click();

	await expect(dialog(page)).toBeHidden();
	await expect(
		ruleRow(page, `Si Libellé contient ${after}, alors Catégorie ${category.name}`),
	).toBeVisible();
	await expect(ruleRow(page, before)).toHaveCount(0);

	await ruleRow(page, after)
		.getByRole("button", { name: /^Actions pour / })
		.click();
	await page.getByRole("menuitem", { name: "Supprimer" }).click();
	const confirm = page.getByRole("alertdialog");
	await expect(confirm.getByRole("button", { name: "Annuler" })).toBeFocused();
	await confirm.getByRole("button", { name: "Supprimer" }).click();

	await expect(confirm).toBeHidden();
	await expect(page.getByText("Aucune règle pour l'instant.")).toBeVisible();
});

test("« Modifier » on an amount rule shows the amount as typed, and saving it unchanged keeps it", async ({
	page,
	api,
}) => {
	const category = await api.createCategory();
	await api.createRule({
		conditions: [{ conditionType: "transaction_amount", operator: ">", value: "50,00" }],
		categoryId: category.id,
	});
	const summary = `Si Montant > 50,00\u00a0€, alors Catégorie ${category.name}`;
	await visit(page);

	await ruleRow(page, summary)
		.getByRole("button", { name: /^Actions pour / })
		.click();
	await page.getByRole("menuitem", { name: "Modifier" }).click();
	await expect(dialog(page).getByLabel("Valeur de la condition 1")).toHaveValue("50,00");
	await dialog(page).getByRole("button", { name: "Enregistrer" }).click();

	await expect(dialog(page)).toBeHidden();
	await expect(
		page.locator("[data-sonner-toast]").filter({ hasText: "Règle enregistrée." }),
	).toBeVisible();
	await expect(ruleRow(page, summary)).toBeVisible();
});

test("the form points at an empty value or a missing action, and saves nothing", async ({
	page,
}) => {
	await visit(page);
	await page.getByRole("button", { name: "Ajouter une règle" }).click();

	await dialog(page).getByRole("button", { name: "Enregistrer" }).click();
	await expect(dialog(page).getByLabel("Valeur de la condition 1")).toHaveAttribute(
		"aria-invalid",
		"true",
	);
	await expect(dialog(page).getByText("Ce champ est obligatoire.")).toHaveCount(2);

	await dialog(page).getByLabel("Valeur de la condition 1").fill("carrefour");
	await dialog(page).getByRole("button", { name: "Retirer l'action" }).click();
	await dialog(page).getByRole("button", { name: "Enregistrer" }).click();
	await expect(dialog(page).getByText("Ajoutez au moins une action.")).toBeVisible();

	await dialog(page).getByRole("button", { name: "Annuler" }).click();
	await expect(page.getByText("Aucune règle pour l'instant.")).toBeVisible();
});

test("a narrow screen says the page needs a computer", async ({ page }) => {
	await page.setViewportSize({ width: 375, height: 800 });
	await page.goto(PAGE);

	await expect(page.getByText("Disponible sur ordinateur")).toBeVisible();
	await expect(page.getByRole("button", { name: "Ajouter une règle" })).toHaveCount(0);
});
