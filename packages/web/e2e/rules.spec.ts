import type { Page } from "@playwright/test";

import { daysAgo, expect, sgml, test, typed, uniqueName } from "./fixtures.ts";

// Stories 8.1 and 8.2: rules at `/regles`. One database serves the whole
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

const categoryAction = (value: string) => ({ actionType: "set_transaction_category", value });

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
		actions: [categoryAction(category.id)],
	});
	const name = uniqueName("Loyer");
	await api.createRule({
		name,
		conditions: [labelLike("loyer")],
		actions: [categoryAction(category.id)],
	});

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
		actions: [categoryAction(category.id)],
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
		actions: [categoryAction(category.id)],
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
		actions: [categoryAction(category.id)],
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

test("« À partir du » is saved with the rule and shown again by « Modifier »", async ({ page }) => {
	const value = uniqueName("marche");
	const date = typed(daysAgo(10));
	await visit(page);

	await page.getByRole("button", { name: "Ajouter une règle" }).click();
	await dialog(page).getByLabel("À partir du").fill(date);
	await dialog(page).getByLabel("Valeur de la condition 1").fill(value);
	await dialog(page).getByRole("button", { name: "Catégorie", exact: true }).click();
	await page.getByRole("option", { name: "Courses", exact: true }).click();
	await dialog(page).getByRole("button", { name: "Enregistrer" }).click();
	await expect(dialog(page)).toBeHidden();

	await ruleRow(page, value)
		.getByRole("button", { name: /^Actions pour / })
		.click();
	await page.getByRole("menuitem", { name: "Modifier" }).click();
	await expect(dialog(page).getByLabel("À partir du")).toHaveValue(date);
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
	await dialog(page).getByRole("button", { name: "Retirer l'action 1" }).click();
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

// Story 8.2: the other conditions and actions.

/** Picks `option` in the select named `name` inside the rule form. */
async function choose(page: Page, name: string, option: string) {
	await dialog(page).getByRole("combobox", { name, exact: true }).click();
	await page.getByRole("option", { name: option, exact: true }).click();
}

/** The options the select named `name` offers, closed again afterwards. */
async function optionsOf(page: Page, name: string) {
	await dialog(page).getByRole("combobox", { name, exact: true }).click();
	const options = await page.getByRole("option").allTextContents();
	await page.keyboard.press("Escape");

	return options;
}

test("the form offers the merchant, category, tag, notes and type fields, and « est vide » hides the value", async ({
	page,
}) => {
	await visit(page);
	await page.getByRole("button", { name: "Ajouter une règle" }).click();

	expect(await optionsOf(page, "Champ de la condition 1")).toEqual([
		"Libellé",
		"Montant",
		"Compte",
		"Marchand",
		"Catégorie",
		"Étiquette",
		"Notes",
		"Type",
	]);

	await choose(page, "Champ de la condition 1", "Marchand");
	expect(await optionsOf(page, "Opérateur de la condition 1")).toEqual(["est", "est vide"]);
	await choose(page, "Champ de la condition 1", "Catégorie");
	expect(await optionsOf(page, "Opérateur de la condition 1")).toEqual(["est", "est vide"]);
	await choose(page, "Champ de la condition 1", "Étiquette");
	expect(await optionsOf(page, "Opérateur de la condition 1")).toEqual(["est", "est vide"]);

	await choose(page, "Champ de la condition 1", "Notes");
	expect(await optionsOf(page, "Opérateur de la condition 1")).toEqual([
		"contient",
		"est égal à",
		"est vide",
	]);
	await expect(dialog(page).getByLabel("Valeur de la condition 1")).toBeVisible();
	await choose(page, "Opérateur de la condition 1", "est vide");
	await expect(dialog(page).getByLabel("Valeur de la condition 1")).toHaveCount(0);

	await choose(page, "Champ de la condition 1", "Type");
	expect(await optionsOf(page, "Opérateur de la condition 1")).toEqual(["est"]);
	expect(await optionsOf(page, "Valeur de la condition 1")).toEqual([
		"Revenu",
		"Dépense",
		"Virement",
	]);
});

test("a merchant condition saved through its picker reads « Marchand est … » in the list", async ({
	page,
	api,
}) => {
	const merchant = await api.createMerchant(uniqueName("Amazon"));
	const category = await api.createCategory();
	await visit(page);

	await page.getByRole("button", { name: "Ajouter une règle" }).click();
	await choose(page, "Champ de la condition 1", "Marchand");
	await dialog(page).getByRole("button", { name: "Valeur de la condition 1", exact: true }).click();
	await page.getByRole("option", { name: merchant.name, exact: true }).click();
	await dialog(page).getByRole("button", { name: "Catégorie", exact: true }).click();
	await page.getByRole("option", { name: category.name, exact: true }).click();
	await dialog(page).getByRole("button", { name: "Enregistrer" }).click();

	await expect(dialog(page)).toBeHidden();
	await expect(
		ruleRow(page, `Si Marchand est ${merchant.name}, alors Catégorie ${category.name}`),
	).toBeVisible();
});

test("a rule with four actions sets the merchant, a tag and the label of an imported line and excludes it", async ({
	page,
	api,
}) => {
	const account = await api.openAccount();
	const merchant = await api.createMerchant(uniqueName("Amazon"));
	const tag = await api.createTag(uniqueName("Achats"));
	const marker = uniqueName("AMZN").replace(" ", "-");
	const renamed = uniqueName("Amazon");
	await visit(page);

	await page.getByRole("button", { name: "Ajouter une règle" }).click();
	await dialog(page).getByLabel("Valeur de la condition 1").fill(marker);
	await choose(page, "Action 1", "Marchand");
	await dialog(page).getByRole("button", { name: "Marchand", exact: true }).click();
	await page.getByRole("option", { name: merchant.name, exact: true }).click();
	await dialog(page).getByRole("button", { name: "Ajouter une action" }).click();
	await choose(page, "Action 2", "Ajouter une étiquette");
	await dialog(page).getByRole("button", { name: "Ajouter une étiquette", exact: true }).click();
	await page.getByRole("option", { name: tag.name, exact: true }).click();
	await dialog(page).getByRole("button", { name: "Ajouter une action" }).click();
	await choose(page, "Action 3", "Renommer");
	await dialog(page).getByRole("textbox", { name: "Renommer", exact: true }).fill(renamed);
	await dialog(page).getByRole("button", { name: "Ajouter une action" }).click();
	await choose(page, "Action 4", "Exclure");
	await dialog(page).getByRole("button", { name: "Enregistrer" }).click();

	await expect(dialog(page)).toBeHidden();
	await expect(
		ruleRow(
			page,
			`Si Libellé contient ${marker}, alors Marchand ${merchant.name}, et 3 autres actions`,
		),
	).toBeVisible();

	await api.importFile(
		account.id,
		sgml([{ daysAgo: 2, amount: "-42,90", label: `CB ${marker} MKTP`, fitid: uniqueName("A") }]),
	);
	await page.goto(`/operations?q=${encodeURIComponent(renamed)}`);
	const row = page.getByRole("main").getByRole("listitem").filter({ hasText: renamed });
	await expect(row).toContainText(merchant.name);
	await expect(row).toContainText(tag.name);
	await expect(row).toContainText("Exclue des rapports");
});

test("a rule « Virement avec » pairs a matching line with the one opposite line of that account", async ({
	page,
	api,
}) => {
	const checking = await api.openAccount({ name: uniqueName("Compte courant") });
	const livret = await api.openAccount({ name: uniqueName("Livret A"), kind: "savings" });
	const other = await api.openAccount({ name: uniqueName("Compte joint") });
	const marker = uniqueName("EPARGNE").replace(" ", "-");
	const amount = "613,47";
	await api.addTransaction(livret.id, {
		date: daysAgo(5),
		label: `${marker} arrivée`,
		amount,
	});
	// A second opposite line elsewhere: without the rule, neither would pair.
	await api.addTransaction(other.id, { date: daysAgo(4), label: `${marker} autre`, amount });
	await api.createRule({
		conditions: [labelLike(`${marker} départ`)],
		actions: [{ actionType: "set_as_transfer_or_payment", value: livret.id }],
	});

	await api.addTransaction(checking.id, {
		date: daysAgo(3),
		label: `${marker} départ`,
		amount: `-${amount}`,
	});

	await page.goto(`/operations?q=${encodeURIComponent(marker)}`);
	const rowOf = (label: string) =>
		page.getByRole("main").getByRole("listitem").filter({ hasText: label });
	await expect(rowOf(`${marker} départ`).getByText("Virement", { exact: true })).toBeVisible();
	await expect(rowOf(`${marker} arrivée`).getByText("Virement", { exact: true })).toBeVisible();
	await expect(rowOf(`${marker} autre`).getByText("Virement", { exact: true })).toHaveCount(0);
});

test("the form points at an empty « Renommer » and saves nothing", async ({ page }) => {
	await visit(page);
	await page.getByRole("button", { name: "Ajouter une règle" }).click();
	await dialog(page).getByLabel("Valeur de la condition 1").fill("carrefour");
	await choose(page, "Action 1", "Renommer");

	await dialog(page).getByRole("button", { name: "Enregistrer" }).click();

	const rename = dialog(page).getByRole("textbox", { name: "Renommer", exact: true });
	await expect(rename).toHaveAttribute("aria-invalid", "true");
	await expect(dialog(page).getByText("Ce champ est obligatoire.")).toBeVisible();
	await dialog(page).getByRole("button", { name: "Annuler" }).click();
	await expect(page.getByText("Aucune règle pour l'instant.")).toBeVisible();
});
