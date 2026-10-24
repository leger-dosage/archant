import type { Page } from "@playwright/test";

import { FAKE_ACCOUNTS, FAKE_LINES } from "./fake-enable-banking.ts";
import { daysAgo, expect, sgml, test, typed, uniqueName } from "./fixtures.ts";
import { WEB_URL } from "./settings.ts";

// Stories 8.1, 8.2 and 8.3: rules at `/rules`. One database serves the whole
// run, and an enabled rule reaches every transaction at each sync or import,
// so each test deletes its rules before the next one starts.

test.afterEach(async ({ api }) => {
	await api.deleteRules();
});

const PAGE = "/rules";

const rulesList = (page: Page) => page.getByRole("list", { name: "Règles" });

const ruleRow = (page: Page, text: string) =>
	rulesList(page).getByRole("listitem").filter({ hasText: text });

// Named: the category combobox's popover is a dialog too.
const dialog = (page: Page) =>
	page.getByRole("dialog", { name: /^(Ajouter une|Modifier la) règle$/u });

const categoryAction = (value: string) => ({ actionType: "set_transaction_category", value });

// The confirmation after a creation or from a menu, the only alert dialog then open.
const applyDialog = (page: Page) => page.getByRole("alertdialog");

/**
 * Closes the confirmation a new rule opens, which leaves it disabled, then
 * switches it on: it reaches the lines to come, and no existing one.
 */
async function later(page: Page) {
	await applyDialog(page).getByRole("button", { name: "Annuler" }).click();
	await expect(applyDialog(page)).toBeHidden();
	const off = rulesList(page).getByRole("switch", { checked: false });
	await expect(off).toHaveCount(1);
	await off.click();
	await expect(rulesList(page).getByRole("switch", { checked: false })).toHaveCount(0);
}

const labelLike = (value: string) => ({
	conditionType: "transaction_name",
	operator: "like",
	value,
});

/** A transaction's category chip on `/transactions`, narrowed to its label. */
async function expectCategory(page: Page, label: string, category: string) {
	await page.goto(`/transactions?q=${encodeURIComponent(label)}`);
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

test("the rail opens Règles, empty at first", async ({ page }) => {
	await page.goto("/accounts");
	await page
		.getByRole("navigation", { name: "Navigation principale" })
		.getByRole("link", { name: "Règles", exact: true })
		.click();

	await expect(page).toHaveURL(/\/rules$/u);
	await expect(page.getByRole("heading", { name: "Aucune règle pour l'instant" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Ajouter une règle" })).toBeVisible();
});

test("a rule saved from the form categorises the next imported transaction it matches", async ({
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
	await later(page);
	const row = ruleRow(page, "Si Libellé contient carrefour, alors Catégorie Courses");
	await expect(row).toBeVisible();
	await expect(row.getByRole("switch")).toBeChecked();

	// An import ends with every enabled rule over the history, as Sure's sync after it.
	const label = uniqueName("CB CARREFOUR");
	await api.importFile(
		account.id,
		sgml([{ daysAgo: 2, amount: "-42,90", label, fitid: label.replaceAll(" ", "-") }]),
	);
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
	// Story 12.4: the pick shows as the category's pill, with its icon.
	await expect(
		dialog(page)
			.getByRole("button", { name: "Catégorie", exact: true })
			.locator('[data-slot="category-pill"] svg.lucide-tag'),
	).toBeVisible();
	await value.fill(after);
	await dialog(page).getByRole("button", { name: "Enregistrer" }).click();

	// An edit asks nothing and keeps the switch, as Sure's `update`.
	await expect(dialog(page)).toBeHidden();
	await expect(applyDialog(page)).toHaveCount(0);
	await expect(
		ruleRow(page, `Si Libellé contient ${after}, alors Catégorie ${category.name}`),
	).toBeVisible();
	await expect(ruleRow(page, before)).toHaveCount(0);
	await expect(ruleRow(page, after).getByRole("switch")).toBeChecked();

	await ruleRow(page, after)
		.getByRole("button", { name: /^Actions pour / })
		.click();
	await page.getByRole("menuitem", { name: "Supprimer" }).click();
	const confirm = page.getByRole("alertdialog");
	await expect(confirm.getByRole("button", { name: "Annuler" })).toBeFocused();
	await confirm.getByRole("button", { name: "Supprimer" }).click();

	await expect(confirm).toBeHidden();
	await expect(page.getByRole("heading", { name: "Aucune règle pour l'instant" })).toBeVisible();
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
	const summary = `Si Montant > 50,00, alors Catégorie ${category.name}`;
	await visit(page);

	await ruleRow(page, summary)
		.getByRole("button", { name: /^Actions pour / })
		.click();
	await page.getByRole("menuitem", { name: "Modifier" }).click();
	await expect(dialog(page).getByLabel("Valeur de la condition 1")).toHaveValue("50.00");
	await dialog(page).getByRole("button", { name: "Enregistrer" }).click();

	// An edit asks nothing, as Sure's `update`.
	await expect(dialog(page)).toBeHidden();
	await expect(applyDialog(page)).toHaveCount(0);
	await expect(
		page.locator("[data-sonner-toast]").filter({ hasText: "Règle enregistrée." }),
	).toBeVisible();
	await expect(ruleRow(page, summary)).toBeVisible();
});

test("an amount rule saved from the form steps by the cent and categorises a line in dollars once confirmed", async ({
	page,
	api,
}) => {
	const dollars = await api.openAccount({ name: uniqueName("Compte en dollars"), currency: "USD" });
	const category = await api.createCategory();
	// The label keeps the rule off the lines other test files add meanwhile.
	const marker = uniqueName("AMAZON");
	const label = `${marker} US`;
	await api.addTransaction(dollars.id, { date: daysAgo(2), label, amount: "-60,00" });
	await visit(page);

	await page.getByRole("button", { name: "Ajouter une règle" }).click();
	await choose(page, "Champ de la condition 1", "Montant");
	await choose(page, "Opérateur de la condition 1", ">");
	const amount = dialog(page).getByLabel("Valeur de la condition 1");
	await expect(amount).toHaveAttribute("type", "number");
	await expect(amount).toHaveAttribute("step", "0.01");
	await amount.fill("50");
	await dialog(page).getByRole("button", { name: "Ajouter une condition" }).click();
	await dialog(page).getByLabel("Valeur de la condition 2").fill(marker);
	await dialog(page).getByRole("button", { name: "Catégorie", exact: true }).click();
	await page.getByRole("option", { name: category.name, exact: true }).click();
	await dialog(page).getByRole("button", { name: "Enregistrer" }).click();

	await expect(dialog(page)).toBeHidden();
	await applyDialog(page).getByRole("button", { name: "Confirmer les modifications" }).click();
	await expect(applyDialog(page)).toBeHidden();
	await expect(ruleRow(page, `Si Montant > 50, alors Catégorie ${category.name}`)).toBeVisible();

	await expectCategory(page, label, category.name);
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
	await later(page);

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
	await expect(page.getByRole("heading", { name: "Aucune règle pour l'instant" })).toBeVisible();
});

test("a narrow screen says the page needs a computer", async ({ page }) => {
	await page.setViewportSize({ width: 375, height: 800 });
	await page.goto(PAGE);

	// Story 14.4: a card holding its sentence, as DESIGN.md's empty note.
	const note = page.locator('[data-slot="empty-note"]', { hasText: "Disponible sur ordinateur" });
	await expect(note).toBeVisible();
	await expect(note).toHaveCSS("border-radius", "12px");
	await expect(note).toHaveCSS("border-top-style", "solid");
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

test("the form offers Sure's operators per field, and « Est vide » and « N'est pas vide » hide the value", async ({
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
		"Détails bancaires",
		"Notes",
		"Type",
	]);

	const text = [
		"Contient",
		"Ne contient pas",
		"Égal à",
		"Différent de",
		"Est vide",
		"N'est pas vide",
	];
	const select = ["Égal à", "Différent de", "Est vide", "N'est pas vide"];

	expect(await optionsOf(page, "Opérateur de la condition 1")).toEqual(text);

	await choose(page, "Champ de la condition 1", "Compte");
	expect(await optionsOf(page, "Opérateur de la condition 1")).toEqual(select);
	await choose(page, "Champ de la condition 1", "Marchand");
	expect(await optionsOf(page, "Opérateur de la condition 1")).toEqual(select);
	await choose(page, "Champ de la condition 1", "Catégorie");
	expect(await optionsOf(page, "Opérateur de la condition 1")).toEqual(select);

	await choose(page, "Champ de la condition 1", "Étiquette");
	expect(await optionsOf(page, "Opérateur de la condition 1")).toEqual(["Égal à", "Est vide"]);

	await choose(page, "Champ de la condition 1", "Détails bancaires");
	expect(await optionsOf(page, "Opérateur de la condition 1")).toEqual([
		"Contient",
		"Égal à",
		"Est vide",
	]);

	await choose(page, "Champ de la condition 1", "Notes");
	expect(await optionsOf(page, "Opérateur de la condition 1")).toEqual(text);
	await expect(dialog(page).getByLabel("Valeur de la condition 1")).toBeVisible();
	await choose(page, "Opérateur de la condition 1", "Est vide");
	await expect(dialog(page).getByLabel("Valeur de la condition 1")).toHaveCount(0);
	await choose(page, "Opérateur de la condition 1", "Ne contient pas");
	await expect(dialog(page).getByLabel("Valeur de la condition 1")).toBeVisible();
	await choose(page, "Opérateur de la condition 1", "N'est pas vide");
	await expect(dialog(page).getByLabel("Valeur de la condition 1")).toHaveCount(0);

	await choose(page, "Champ de la condition 1", "Type");
	expect(await optionsOf(page, "Opérateur de la condition 1")).toEqual(["Égal à"]);
	expect(await optionsOf(page, "Valeur de la condition 1")).toEqual([
		"Revenu",
		"Dépense",
		"Virement",
	]);
});

test("a rule « Libellé » « Ne contient pas » reads so in the list", async ({ page }) => {
	const marker = uniqueName("virement");
	await visit(page);

	await page.getByRole("button", { name: "Ajouter une règle" }).click();
	await choose(page, "Opérateur de la condition 1", "Ne contient pas");
	await dialog(page).getByLabel("Valeur de la condition 1").fill(marker);
	await dialog(page).getByRole("button", { name: "Catégorie", exact: true }).click();
	await page.getByRole("option", { name: "Courses", exact: true }).click();
	await dialog(page).getByRole("button", { name: "Enregistrer" }).click();

	await expect(dialog(page)).toBeHidden();
	await later(page);
	await expect(
		ruleRow(page, `Si Libellé ne contient pas ${marker}, alors Catégorie Courses`),
	).toBeVisible();
});

test("a rule « Détails bancaires » « Contient » is saved, read in the list and reopened as typed", async ({
	page,
}) => {
	await visit(page);

	await page.getByRole("button", { name: "Ajouter une règle" }).click();
	await choose(page, "Champ de la condition 1", "Détails bancaires");
	await dialog(page).getByLabel("Valeur de la condition 1").fill("5411");
	await dialog(page).getByRole("button", { name: "Catégorie", exact: true }).click();
	await page.getByRole("option", { name: "Courses", exact: true }).click();
	await dialog(page).getByRole("button", { name: "Enregistrer" }).click();

	await expect(dialog(page)).toBeHidden();
	await later(page);
	const row = ruleRow(page, "Si Détails bancaires contient 5411, alors Catégorie Courses");
	await expect(row).toBeVisible();

	await row.getByRole("button", { name: /^Actions pour /u }).click();
	await page.getByRole("menuitem", { name: "Modifier" }).click();
	await expect(dialog(page).getByLabel("Champ de la condition 1")).toHaveText("Détails bancaires");
	await expect(dialog(page).getByLabel("Opérateur de la condition 1")).toHaveText("Contient");
	await expect(dialog(page).getByLabel("Valeur de la condition 1")).toHaveValue("5411");
});

test("a rule setting the activity label « Dividende » offers Sure's 13 labels, reads so in the list and reopens as saved", async ({
	page,
}) => {
	const marker = uniqueName("dividende");
	await visit(page);

	await page.getByRole("button", { name: "Ajouter une règle" }).click();
	await dialog(page).getByLabel("Valeur de la condition 1").fill(marker);
	await choose(page, "Action 1", "Définir le libellé d'activité");
	await expect(dialog(page).getByLabel("Définir le libellé d'activité")).toHaveText("Achat");
	expect(await optionsOf(page, "Définir le libellé d'activité")).toEqual([
		"Achat",
		"Vente",
		"Balayage entrant",
		"Balayage sortant",
		"Dividende",
		"Réinvestissement",
		"Intérêts",
		"Frais",
		"Transfert",
		"Contribution",
		"Retrait",
		"Échange",
		"Autre",
	]);
	await choose(page, "Définir le libellé d'activité", "Dividende");
	await dialog(page).getByRole("button", { name: "Enregistrer" }).click();

	await expect(dialog(page)).toBeHidden();
	await later(page);
	const row = ruleRow(page, `Si Libellé contient ${marker}, alors Libellé d'activité : Dividende`);
	await expect(row).toBeVisible();

	await row.getByRole("button", { name: /^Actions pour /u }).click();
	await page.getByRole("menuitem", { name: "Modifier" }).click();
	await expect(dialog(page).getByLabel("Action 1", { exact: true })).toHaveText(
		"Définir le libellé d'activité",
	);
	await expect(dialog(page).getByLabel("Définir le libellé d'activité")).toHaveText("Dividende");
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
	// A new merchant holds no transaction yet.
	await expect(applyDialog(page).getByRole("heading")).toHaveText("Confirmer les modifications");
	await expect(applyDialog(page)).toContainText(
		"Vous êtes sur le point d'appliquer cette règle à 0 opération qui répond à ses critères.",
	);
	await later(page);
	await expect(
		ruleRow(page, `Si Marchand est ${merchant.name}, alors Catégorie ${category.name}`),
	).toBeVisible();
});

test("a rule with four actions sets the merchant, two tags and the label of an imported line and excludes it", async ({
	page,
	api,
}) => {
	const account = await api.openAccount();
	const merchant = await api.createMerchant(uniqueName("Amazon"));
	const tag = await api.createTag(uniqueName("Achats"));
	const other = await api.createTag(uniqueName("Livres"));
	const marker = uniqueName("AMZN").replace(" ", "-");
	const renamed = uniqueName("Amazon");
	await visit(page);

	await page.getByRole("button", { name: "Ajouter une règle" }).click();
	await dialog(page).getByLabel("Valeur de la condition 1").fill(marker);
	await choose(page, "Action 1", "Marchand");
	await dialog(page).getByRole("button", { name: "Marchand", exact: true }).click();
	await page.getByRole("option", { name: merchant.name, exact: true }).click();
	await dialog(page).getByRole("button", { name: "Ajouter une action" }).click();
	await choose(page, "Action 2", "Ajouter des étiquettes");
	const tags = dialog(page).getByRole("button", { name: "Ajouter des étiquettes", exact: true });
	await expect(tags).toHaveText("Choisir des étiquettes");
	await tags.click();
	// One picker ticks several tags, as Sure's tag select, and stays open.
	const otherOption = page.getByRole("option", { name: other.name, exact: true });
	await page.getByRole("option", { name: tag.name, exact: true }).click();
	await otherOption.click();
	await expect(otherOption).toHaveAttribute("aria-checked", "true");
	// A second tick takes the tag off again.
	await otherOption.click();
	await expect(otherOption).toHaveAttribute("aria-checked", "false");
	await otherOption.click();
	await page.keyboard.press("Escape");
	await expect(tags).toHaveText(`${tag.name}, ${other.name}`);
	await dialog(page).getByRole("button", { name: "Ajouter une action" }).click();
	await choose(page, "Action 3", "Renommer");
	await dialog(page).getByRole("textbox", { name: "Renommer", exact: true }).fill(renamed);
	await dialog(page).getByRole("button", { name: "Ajouter une action" }).click();
	await choose(page, "Action 4", "Exclure");
	await dialog(page).getByRole("button", { name: "Enregistrer" }).click();

	await expect(dialog(page)).toBeHidden();
	await later(page);
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
	await page.goto(`/transactions?q=${encodeURIComponent(renamed)}`);
	const row = page.getByRole("main").getByRole("listitem").filter({ hasText: renamed });
	await expect(row).toContainText(merchant.name);
	await expect(row).toContainText(tag.name);
	await expect(row).toContainText(other.name);
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
	await api.createRule({
		conditions: [labelLike(`${marker} départ`)],
		actions: [{ actionType: "set_as_transfer_or_payment", value: livret.id }],
	});
	// Imported alone, so the matcher, which runs before the rules as Sure's
	// post-sync, leaves it free for the expectation the rule then sets.
	await api.importFile(
		checking.id,
		sgml([{ daysAgo: 3, amount: `-${amount}`, label: `${marker} départ`, fitid: uniqueName("F") }]),
	);
	// A closer opposite line elsewhere: without the rule, it would pair.
	await api.addTransaction(other.id, { date: daysAgo(4), label: `${marker} autre`, amount });
	await api.addTransaction(livret.id, {
		date: daysAgo(5),
		label: `${marker} arrivée`,
		amount,
	});

	await page.goto(`/transactions?q=${encodeURIComponent(marker)}`);
	const rowOf = (label: string) =>
		page.getByRole("main").getByRole("listitem").filter({ hasText: label });
	await expect(rowOf(`${marker} départ`).getByText("Virement", { exact: true })).toBeVisible();
	// Paired with the line on the page, the inflow shows once, as its outflow.
	await expect(rowOf(`${marker} arrivée`)).toHaveCount(0);
	await expect(rowOf(`${marker} départ`)).toContainText("Vers");
	await expect(rowOf(`${marker} autre`).getByText("Virement", { exact: true })).toHaveCount(0);
	await page.goto(`/transactions?q=${encodeURIComponent(`${marker} arrivée`)}`);
	await expect(rowOf(`${marker} arrivée`).getByText("Virement", { exact: true })).toBeVisible();
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
	await expect(page.getByRole("heading", { name: "Aucune règle pour l'instant" })).toBeVisible();
});

// Story 8.4: replace in the label.

test("a replacement in the label cleans the label of an imported card terminal line", async ({
	page,
	api,
}) => {
	const account = await api.openAccount();
	const marker = uniqueName("LECLERC").replace(" ", "-");
	await visit(page);

	await page.getByRole("button", { name: "Ajouter une règle" }).click();
	await dialog(page).getByLabel("Valeur de la condition 1").fill(marker);
	await choose(page, "Action 1", "Remplacer dans le libellé");
	await dialog(page).getByRole("textbox", { name: "Rechercher", exact: true }).fill("\\\\");
	await dialog(page).getByRole("textbox", { name: "Remplacer par", exact: true }).fill(" ");
	await dialog(page).getByRole("button", { name: "Enregistrer" }).click();

	await expect(dialog(page)).toBeHidden();
	await later(page);
	await expect(ruleRow(page, `Si Libellé contient ${marker}, alors Remplacer`)).toBeVisible();

	await api.importFile(
		account.id,
		sgml([
			{
				daysAgo: 2,
				amount: "-42,90",
				label: `${marker}\\ANCENIS-SAINT\\ FR`,
				fitid: uniqueName("A"),
			},
		]),
	);
	await page.goto(`/transactions?q=${encodeURIComponent(marker)}`);
	await expect(
		page
			.getByRole("main")
			.getByRole("listitem")
			.filter({ hasText: `${marker} ANCENIS-SAINT FR` }),
	).toBeVisible();
});

test("the form points at a pattern RE2 refuses and saves nothing", async ({ page }) => {
	await visit(page);
	await page.getByRole("button", { name: "Ajouter une règle" }).click();
	await dialog(page).getByLabel("Valeur de la condition 1").fill("carrefour");
	await choose(page, "Action 1", "Remplacer dans le libellé");
	await dialog(page).getByRole("textbox", { name: "Rechercher", exact: true }).fill("(a)\\1");

	await dialog(page).getByRole("button", { name: "Enregistrer" }).click();

	await expect(
		dialog(page).getByRole("textbox", { name: "Rechercher", exact: true }),
	).toHaveAttribute("aria-invalid", "true");
	await expect(dialog(page).getByText(/^Expression non reconnue\./u)).toBeVisible();
	await dialog(page).getByRole("button", { name: "Annuler" }).click();
	await expect(page.getByRole("heading", { name: "Aucune règle pour l'instant" })).toBeVisible();
});

/** Opens « Modifier » on the rule, checks the replacement it shows, and saves it unchanged. */
async function reopenAndSaveReplacement(page: Page, marker: string) {
	await ruleRow(page, marker)
		.getByRole("button", { name: /^Actions pour / })
		.click();
	await page.getByRole("menuitem", { name: "Modifier" }).click();
	await expect(dialog(page).getByRole("textbox", { name: "Rechercher", exact: true })).toHaveValue(
		"\\\\",
	);
	await expect(
		dialog(page).getByRole("textbox", { name: "Remplacer par", exact: true }),
	).toHaveValue(" ");
	await dialog(page).getByRole("button", { name: "Enregistrer" }).click();
	await expect(dialog(page)).toBeHidden();
}

test("« Modifier » reopens a replacement as typed, and saving it unchanged keeps it", async ({
	page,
	api,
}) => {
	const marker = uniqueName("LECLERC").replace(" ", "-");
	await api.createRule({
		conditions: [labelLike(marker)],
		actions: [{ actionType: "replace_in_transaction_name", value: "\\\\", replacement: " " }],
	});
	await visit(page);
	await expect(ruleRow(page, "par une espace")).toBeVisible();

	await reopenAndSaveReplacement(page, marker);
	await reopenAndSaveReplacement(page, marker);
});

test("an action changed away from a replacement saves without the replacement typed before", async ({
	page,
}) => {
	const marker = uniqueName("LECLERC").replace(" ", "-");
	await visit(page);
	await page.getByRole("button", { name: "Ajouter une règle" }).click();
	await dialog(page).getByLabel("Valeur de la condition 1").fill(marker);
	await choose(page, "Action 1", "Remplacer dans le libellé");
	await dialog(page).getByRole("textbox", { name: "Remplacer par", exact: true }).fill("x");
	await choose(page, "Action 1", "Renommer");
	await dialog(page).getByRole("textbox", { name: "Renommer", exact: true }).fill("Leclerc");

	await dialog(page).getByRole("button", { name: "Enregistrer" }).click();

	await expect(dialog(page)).toBeHidden();
	await later(page);
	await expect(
		ruleRow(page, `Si Libellé contient ${marker}, alors Renommer en « Leclerc »`),
	).toBeVisible();
});

// Story 8.3: applying rules to existing transactions.

const runsTable = (page: Page) => page.getByRole("table", { name: "Exécutions récentes" });

const runRow = (page: Page, text: string) =>
	runsTable(page).getByRole("row").filter({ hasText: text });

const toast = (page: Page, text: string) =>
	page.locator("[data-sonner-toast]").filter({ hasText: text });

/** Opens the form, fills « Libellé contient `value` » → Courses and saves it. */
async function saveCoursesRule(page: Page, value: string) {
	await page.getByRole("button", { name: "Ajouter une règle" }).click();
	await dialog(page).getByLabel("Valeur de la condition 1").fill(value);
	await dialog(page).getByRole("button", { name: "Catégorie", exact: true }).click();
	await page.getByRole("option", { name: "Courses", exact: true }).click();
	await dialog(page).getByRole("button", { name: "Enregistrer" }).click();
	await expect(dialog(page)).toBeHidden();
}

test("a new rule waits for its confirmation, which enables it and leaves a row set by hand alone", async ({
	page,
	api,
}) => {
	const account = await api.openAccount();
	const leisure = await api.createCategory({ name: uniqueName("Loisirs") });
	const marker = uniqueName("CARREFOUR").replace(" ", "-");
	const labels = [1, 2, 3].map((index) => `CB ${marker} ${index}`);
	const ids = await labels.reduce<Promise<string[]>>(async (previous, label) => {
		const done = await previous;

		return [
			...done,
			await api.addTransaction(account.id, { date: daysAgo(2), label, amount: "-12,30" }),
		];
	}, Promise.resolve([]));
	await api.categorise(ids.slice(2), leisure.id);
	await visit(page);

	await saveCoursesRule(page, marker);

	// Every line it matches, the one set by hand included, as Sure's `affected_resource_count`.
	await expect(applyDialog(page).getByRole("heading")).toHaveText("Confirmer les modifications");
	await expect(applyDialog(page)).toContainText(
		"Vous êtes sur le point d'appliquer cette règle aux 3 opérations qui répondent à ses critères.",
	);
	await applyDialog(page).getByRole("button", { name: "Confirmer les modifications" }).click();
	await expect(applyDialog(page)).toBeHidden();
	await expect(toast(page, "2 opérations modifiées.")).toBeVisible();
	await expect(rulesList(page).getByRole("switch")).toBeChecked();

	await expectCategory(page, `CB ${marker} 1`, "Courses");
	await expectCategory(page, `CB ${marker} 2`, "Courses");
	await expectCategory(page, `CB ${marker} 3`, leisure.name);
});

test("closing the confirmation leaves a new rule disabled, changing nothing and recording no run", async ({
	page,
	api,
}) => {
	const account = await api.openAccount();
	const marker = uniqueName("MONOP").replace(" ", "-");
	await api.addTransaction(account.id, {
		date: daysAgo(3),
		label: `CB ${marker} avant`,
		amount: "-5,00",
	});
	await visit(page);

	await saveCoursesRule(page, marker);
	await expect(applyDialog(page)).toContainText("à 1 opération qui répond à ses critères.");
	await applyDialog(page).getByRole("button", { name: "Annuler" }).click();
	await expect(applyDialog(page)).toBeHidden();
	await expect(rulesList(page).getByRole("switch")).not.toBeChecked();

	await expect(page.getByRole("heading", { level: 2, name: "Exécutions récentes" })).toBeVisible();
	await expect(runRow(page, marker)).toHaveCount(0);
	await expectCategory(page, `CB ${marker} avant`, "Sans catégorie");

	await api.addTransaction(account.id, {
		date: daysAgo(1),
		label: `CB ${marker} après`,
		amount: "-5,00",
	});
	await expectCategory(page, `CB ${marker} après`, "Sans catégorie");
});

test("« Réappliquer la règle » asks the same confirmation and records a run with the rule's label and counts", async ({
	page,
	api,
}) => {
	const account = await api.openAccount();
	const category = await api.createCategory();
	const other = await api.createCategory();
	const marker = uniqueName("PICARD").replace(" ", "-");
	await api.addTransaction(account.id, {
		date: daysAgo(4),
		label: `${marker} un`,
		amount: "-9,00",
	});
	const byHand = await api.addTransaction(account.id, {
		date: daysAgo(3),
		label: `${marker} deux`,
		amount: "-9,00",
	});
	await api.categorise([byHand], other.id);
	await api.createRule({ conditions: [labelLike(marker)], actions: [categoryAction(category.id)] });
	const summary = `Si Libellé contient ${marker}, alors Catégorie ${category.name}`;
	await visit(page);

	await ruleRow(page, summary)
		.getByRole("button", { name: /^Actions pour / })
		.click();
	await page.getByRole("menuitem", { name: "Réappliquer la règle" }).click();
	await expect(applyDialog(page).getByRole("heading")).toHaveText("Confirmer les modifications");
	await expect(applyDialog(page)).toContainText("aux 2 opérations qui répondent à ses critères.");
	await expect(applyDialog(page).getByRole("button", { name: "Annuler" })).toBeFocused();
	await applyDialog(page).getByRole("button", { name: "Confirmer les modifications" }).click();
	await expect(applyDialog(page)).toBeHidden();

	const cells = runRow(page, summary).getByRole("cell");
	await expect(cells).toHaveText([/\S/u, "Manuel", "Réussi", summary, "2", "1"]);
});

/** The cells of a manual run that succeeded, its time aside. */
const manual = (name: string, processed: string, modified: string) => [
	/\S/u,
	"Manuel",
	"Réussi",
	name,
	processed,
	modified,
];

test("« Appliquer tout » counts distinct rows over every rule, a disabled one included and left so", async ({
	page,
	api,
}) => {
	const account = await api.openAccount();
	const category = await api.createCategory();
	const merchant = await api.createMerchant(uniqueName("Amazon"));
	const tag = await api.createTag();
	const marker = uniqueName("AMZN").replace(" ", "-");
	await api.addTransaction(account.id, {
		date: daysAgo(4),
		label: `${marker} livre`,
		amount: "-20,00",
	});
	await api.addTransaction(account.id, {
		date: daysAgo(3),
		label: `${marker} disque`,
		amount: "-15,00",
	});
	const disabledName = uniqueName("Désactivée");
	const disabled = await api.createRule({
		name: disabledName,
		conditions: [labelLike(marker)],
		actions: [{ actionType: "set_transaction_tags", value: tag.id }],
	});
	const switched = await page.request.patch(`/api/rules/${disabled}`, { data: { enabled: false } });
	expect(switched.ok()).toBe(true);

	const first = uniqueName("Catégorie");
	const second = uniqueName("Marchand");
	await api.createRule({
		name: first,
		conditions: [labelLike(marker)],
		actions: [categoryAction(category.id)],
	});
	await api.createRule({
		name: second,
		conditions: [labelLike(`${marker} livre`)],
		actions: [{ actionType: "set_transaction_merchant", value: merchant.id }],
	});
	await visit(page);

	await page.getByRole("button", { name: "Appliquer tout", exact: true }).click();
	await expect(applyDialog(page).getByRole("heading")).toHaveText("Appliquer toutes les règles");
	await expect(applyDialog(page)).toContainText(
		"Vous êtes sur le point d'appliquer 3 règles affectant 2 opérations uniques",
	);
	await applyDialog(page).getByRole("button", { name: "Confirmer et appliquer tout" }).click();
	await expect(applyDialog(page)).toBeHidden();

	await expect(runRow(page, disabledName).getByRole("cell")).toHaveText(
		manual(disabledName, "2", "2"),
	);
	await expect(runRow(page, first).getByRole("cell")).toHaveText(manual(first, "2", "2"));
	await expect(runRow(page, second).getByRole("cell")).toHaveText(manual(second, "1", "1"));
	await expect(ruleRow(page, disabledName).getByRole("switch")).not.toBeChecked();
});

test("« Trier par : » sorts by name, then by update, either way, and keeps it in the link", async ({
	page,
	api,
}) => {
	const [mango = "", apricot = "", zebra = ""] = ["Mangue", "abricot", "Zèbre"].map(uniqueName);
	// One after the other, so each is updated after the one before.
	await [mango, apricot, zebra].reduce(async (previous, name) => {
		await previous;
		await api.createRule({
			name,
			conditions: [labelLike(uniqueName("TRI"))],
			actions: [{ actionType: "exclude_transaction", value: null }],
		});
	}, Promise.resolve());
	const order = (names: string[]) =>
		expect(rulesList(page).getByRole("listitem")).toHaveText(
			names.map((name) => new RegExp(name, "u")),
		);
	await visit(page);

	// By name ascending by default, case and accents folded, as `rules_controller.rb#index`.
	await order([apricot, mango, zebra]);

	await page.getByRole("combobox", { name: "Trier par :" }).click();
	await page.getByRole("option", { name: "Mis à jour à" }).click();
	await order([mango, apricot, zebra]);

	await page.getByRole("button", { name: "Changer le sens du tri" }).click();
	await order([zebra, apricot, mango]);
	await expect(page).toHaveURL(
		/sortBy=updated_at.*direction=desc|direction=desc.*sortBy=updated_at/u,
	);

	await page.reload();
	await order([zebra, apricot, mango]);
});

test("the runs table pages to older runs", async ({ page, api }) => {
	const older = uniqueName("Ancienne");
	const newer = uniqueName("Récente");
	const category = await api.createCategory();
	const olderRule = await api.createRule({
		name: older,
		conditions: [labelLike(older)],
		actions: [categoryAction(category.id)],
	});
	await api.applyRule(olderRule);
	const newerRule = await api.createRule({
		name: newer,
		conditions: [labelLike(newer)],
		actions: [categoryAction(category.id)],
	});
	// One page holds 50 runs: 50 newer ones push the older run to the next.
	await Array.from({ length: 50 }).reduce<Promise<void>>(async (previous) => {
		await previous;
		await api.applyRule(newerRule);
	}, Promise.resolve());
	await visit(page);

	await expect(runRow(page, newer)).toHaveCount(50);
	await expect(runRow(page, older)).toHaveCount(0);

	await page
		.getByRole("navigation", { name: "Pages des exécutions" })
		.getByRole("link", { name: "Suivant" })
		.click();

	await expect(page).toHaveURL(/runsPage=2/u);
	await expect(runRow(page, older)).toBeVisible();
});

// Story 32.10: every enabled rule runs over the history after each sync.

const CONNECTION_URL = /\/settings\/banks\/([0-9a-f-]{36})$/u;

test("a bank sync runs every enabled rule over the history and lists its run as « Planifié »", async ({
	page,
	request,
	api,
}) => {
	await page.goto("/settings/banks");
	await page
		.getByRole("region", { name: "Connecter une banque" })
		.getByRole("button", { name: "Choisir une banque" })
		.click();
	await page
		.getByRole("dialog", { name: "Choisir une banque" })
		.getByRole("button", { name: "Connecter Banque Démo" })
		.click();
	await expect(toast(page, "Banque Démo est connectée.")).toBeVisible();
	await expect(page).toHaveURL(CONNECTION_URL);
	const connectionId = CONNECTION_URL.exec(page.url())?.[1] ?? "";

	try {
		await page.getByRole("combobox", { name: `Que faire de ${FAKE_ACCOUNTS.card.name}` }).click();
		await page.getByRole("option", { name: "Ignorer", exact: true }).click();
		await page.getByRole("button", { name: "Valider" }).click();
		await expect(toast(page, "1 compte relié à la banque.")).toBeVisible();
		await expect(page.getByText("Dernière synchronisation : à l'instant")).toBeVisible();

		// Saved after the lines came in: only the next sync reaches them.
		const category = await api.createCategory();
		const name = uniqueName("Supermarché");
		await api.createRule({
			name,
			conditions: [labelLike(FAKE_LINES.groceries.label)],
			actions: [categoryAction(category.id)],
		});

		await page.getByRole("button", { name: "Synchroniser" }).click();
		await expect(toast(page, "Synchronisation terminée.")).toBeVisible();
		await visit(page);

		await expect(runRow(page, name).getByRole("cell")).toHaveText([
			/\S/u,
			"Planifié",
			"Réussi",
			name,
			/^[1-9]\d*$/u,
			/^[1-9]\d*$/u,
		]);
		// Other files' connections may list the same line: the rule reaches them all.
		await page.goto(`/transactions?q=${encodeURIComponent(FAKE_LINES.groceries.label)}`);
		await expect(
			page
				.getByRole("main")
				.getByRole("button", { name: `Catégorie : ${category.name}`, exact: true })
				.first(),
		).toBeVisible();
	} finally {
		await request.delete(`/api/bank-connections/${connectionId}`, { headers: { origin: WEB_URL } });
	}
});

// Story 11.12: the rule dialog's pickers create what they cannot find.

/** What « Créer » reads in a picker: the category's takes French quotes, as Sure's. */
const createText = (search: string, name: string) =>
	search === "Rechercher une catégorie" ? `Créer « ${name} »` : `Créer "${name}"`;

/** Types `name` in the open picker's search, then picks its « Créer », offered last but the subcategory step. */
async function createFromPicker(page: Page, search: string, name: string) {
	await page.getByRole("combobox", { name: search }).fill(name);
	const create = page.getByRole("option", { name: createText(search, name), exact: true });
	await expect(create).toBeVisible();
	await create.click();
}

test("a merchant created from the action's picker is picked and read back in the list", async ({
	page,
}) => {
	const marker = uniqueName("CB FNAC").replace(" ", "-");
	const name = uniqueName("Fnac");
	await visit(page);

	await page.getByRole("button", { name: "Ajouter une règle" }).click();
	await dialog(page).getByLabel("Valeur de la condition 1").fill(marker);
	await choose(page, "Action 1", "Marchand");
	await dialog(page).getByRole("button", { name: "Marchand", exact: true }).click();
	await expect(page.getByRole("option", { name: "Sans marchand" })).toHaveCount(0);
	await createFromPicker(page, "Rechercher un marchand", name);

	await expect(dialog(page).getByRole("button", { name: "Marchand", exact: true })).toHaveText(
		name,
	);
	await dialog(page).getByRole("button", { name: "Enregistrer" }).click();
	await expect(dialog(page)).toBeHidden();
	await later(page);
	await expect(
		ruleRow(page, `Si Libellé contient ${marker}, alors Marchand ${name}`),
	).toBeVisible();
});

test("a category created from the action's picker lands at the top of the list", async ({
	page,
}) => {
	const marker = uniqueName("CB CINEMA").replace(" ", "-");
	const name = uniqueName("Cinéma");
	await visit(page);

	await page.getByRole("button", { name: "Ajouter une règle" }).click();
	await dialog(page).getByLabel("Valeur de la condition 1").fill(marker);
	await dialog(page).getByRole("button", { name: "Catégorie", exact: true }).click();
	await createFromPicker(page, "Rechercher une catégorie", name);

	await expect(dialog(page).getByRole("button", { name: "Catégorie", exact: true })).toHaveText(
		name,
	);
	await dialog(page).getByRole("button", { name: "Enregistrer" }).click();
	await expect(dialog(page)).toBeHidden();
	await later(page);
	await expect(
		ruleRow(page, `Si Libellé contient ${marker}, alors Catégorie ${name}`),
	).toBeVisible();

	await page.goto("/settings/categories");
	const list = page.getByRole("region", { name: "Catégories", exact: true });
	// A top-level row sits in the list's own block, not in a parent's nested one.
	await expect(
		list
			.locator(":scope > div > ul > li > div")
			.getByRole("button", { name: `Actions pour ${name}`, exact: true }),
	).toBeVisible();
});

test("a tag created from the condition's picker is picked and read back in the list", async ({
	page,
	api,
}) => {
	const category = await api.createCategory();
	const name = uniqueName("Vacances");
	await visit(page);

	await page.getByRole("button", { name: "Ajouter une règle" }).click();
	await choose(page, "Champ de la condition 1", "Étiquette");
	await dialog(page).getByRole("button", { name: "Valeur de la condition 1", exact: true }).click();
	await createFromPicker(page, "Rechercher une étiquette", name);

	await expect(
		dialog(page).getByRole("button", { name: "Valeur de la condition 1", exact: true }),
	).toHaveText(name);
	await dialog(page).getByRole("button", { name: "Catégorie", exact: true }).click();
	await page.getByRole("option", { name: category.name, exact: true }).click();
	await dialog(page).getByRole("button", { name: "Enregistrer" }).click();
	await expect(dialog(page)).toBeHidden();
	await later(page);
	await expect(
		ruleRow(page, `Si Étiquette est ${name}, alors Catégorie ${category.name}`),
	).toBeVisible();
});

test("a name already held in another case offers no « Créer » in the rule's pickers", async ({
	page,
	api,
}) => {
	const merchant = await api.createMerchant(uniqueName("Decathlon"));
	const category = await api.createCategory();
	const tag = await api.createTag(uniqueName("Sport"));
	await visit(page);

	await page.getByRole("button", { name: "Ajouter une règle" }).click();
	await dialog(page).getByRole("button", { name: "Catégorie", exact: true }).click();
	await page
		.getByRole("combobox", { name: "Rechercher une catégorie" })
		.fill(category.name.toUpperCase());
	await expect(page.getByRole("option", { name: category.name, exact: true })).toBeVisible();
	await expect(page.getByRole("option", { name: /^Créer/u })).toHaveCount(0);
	await page.keyboard.press("Escape");

	await choose(page, "Action 1", "Marchand");
	await dialog(page).getByRole("button", { name: "Marchand", exact: true }).click();
	await page
		.getByRole("combobox", { name: "Rechercher un marchand" })
		.fill(merchant.name.toUpperCase());
	await expect(page.getByRole("option", { name: merchant.name, exact: true })).toBeVisible();
	await expect(page.getByRole("option", { name: /^Créer/u })).toHaveCount(0);
	await page.keyboard.press("Escape");

	await choose(page, "Champ de la condition 1", "Étiquette");
	await dialog(page).getByRole("button", { name: "Valeur de la condition 1", exact: true }).click();
	await page
		.getByRole("combobox", { name: "Rechercher une étiquette" })
		.fill(tag.name.toUpperCase());
	await expect(page.getByRole("option", { name: tag.name, exact: true })).toBeVisible();
	await expect(page.getByRole("option", { name: /^Créer/u })).toHaveCount(0);
});

for (const refused of [
	{
		path: "merchants",
		field: "Marchand",
		search: "Rechercher un marchand",
		placeholder: "Choisir un marchand",
	},
	{
		path: "categories",
		field: "Catégorie",
		search: "Rechercher une catégorie",
		placeholder: "Choisir une catégorie",
	},
	{
		path: "tags",
		field: "Ajouter des étiquettes",
		search: "Rechercher une étiquette",
		placeholder: "Choisir des étiquettes",
	},
] as const) {
	test(`a ${refused.path} creation the server refuses shows a destructive toast and keeps the picker open`, async ({
		page,
	}) => {
		await page.route(`**/api/${refused.path}`, (route) =>
			route.request().method() === "POST"
				? route.fulfill({
						status: 500,
						json: { error: { code: "INTERNAL_ERROR", message: "Something went wrong." } },
					})
				: route.continue(),
		);
		const name = uniqueName("Darty");
		await visit(page);

		await page.getByRole("button", { name: "Ajouter une règle" }).click();
		if (refused.field !== "Catégorie") {
			await choose(page, "Action 1", refused.field);
		}
		const button = dialog(page).getByRole("button", { name: refused.field, exact: true });
		await button.click();
		await createFromPicker(page, refused.search, name);

		await expect(
			page.locator("[data-sonner-toast]").filter({
				hasText:
					refused.path === "categories"
						? "Impossible de créer la catégorie"
						: "Une erreur inattendue s'est produite.",
			}),
		).toBeVisible();
		await expect(
			page.getByRole("option", { name: createText(refused.search, name), exact: true }),
		).toBeVisible();
		await expect(button).toHaveText(refused.placeholder);
	});
}
