import type { Locator, Page } from "@playwright/test";

import { daysAgo, expect, test, uniqueName } from "./fixtures.ts";

// Story 4.1: default categories and category management. One database serves
// the whole run, so each test works on categories of its own and never
// changes a default.

const PAGE = "/reglages/categories";

/** A category's row: its dot, icon, name, count and menu. */
const row = (scope: Page | Locator, name: string) =>
	scope.getByRole("button", { name: `Actions pour ${name}`, exact: true }).locator("..");

const group = (page: Page, name: "Revenus" | "Dépenses") =>
	page.getByRole("region", { name, exact: true });

/** Picks a swatch or an icon by clicking its label, as a pointer does: the radio itself is hidden. */
async function pick(dialog: Locator, name: string) {
	const radio = dialog.page().getByRole("radio", { name, exact: true });
	await dialog.locator("label", { has: radio }).click();
	await expect(dialog.getByRole("radio", { name, exact: true })).toBeChecked();
}

async function openAction(
	page: Page,
	name: string,
	action: "Modifier" | "Fusionner" | "Supprimer",
) {
	await page.getByRole("button", { name: `Actions pour ${name}`, exact: true }).click();
	await page.getByRole("menuitem", { name: action }).click();
}

const EXPENSE_DEFAULTS = [
	"Courses",
	"Restaurants",
	"Transports",
	"Logement",
	"Énergie et eau",
	"Abonnements",
	"Assurances",
	"Santé",
	"Impôts et taxes",
	"Frais bancaires",
	"Loisirs",
	"Voyages",
	"Cadeaux et dons",
	"Épargne et placements",
];

test("a fresh instance lists the defaults under Revenus and Dépenses, each with its colour and icon", async ({
	page,
}) => {
	await page.goto(PAGE);
	await expect(page.getByRole("heading", { level: 2, name: "Catégories" })).toBeVisible();

	const income = group(page, "Revenus");
	await expect(row(income, "Revenus")).toBeVisible();
	await expect(row(income, "Revenus").locator("span[aria-hidden]").first()).toHaveCSS(
		"background-color",
		"rgb(34, 197, 94)",
	);
	await expect(row(income, "Revenus").locator("svg.lucide-circle-dollar-sign")).toBeVisible();

	const expenses = group(page, "Dépenses");
	const names = await expenses
		.getByRole("button", { name: /^Actions pour / })
		.evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")));
	expect(names).toEqual(
		expect.arrayContaining(EXPENSE_DEFAULTS.map((name) => `Actions pour ${name}`)),
	);
	await expect(row(expenses, "Courses").locator("span[aria-hidden]").first()).toHaveCSS(
		"background-color",
		"rgb(64, 119, 6)",
	);
	await expect(row(expenses, "Courses").locator("svg.lucide-shopping-bag")).toBeVisible();
	await expect(row(expenses, "Revenus")).toHaveCount(0);

	// French order: « Énergie et eau » sorts under E, before « Frais bancaires ».
	const energy = names.indexOf("Actions pour Énergie et eau");
	expect(energy).toBeGreaterThan(names.indexOf("Actions pour Cadeaux et dons"));
	expect(energy).toBeLessThan(names.indexOf("Actions pour Frais bancaires"));
});

test("a created, renamed, recoloured and moved category shows its changes after a reload", async ({
	page,
	api,
}) => {
	const parent = await api.createCategory({ name: uniqueName("Maison"), color: "#4da568" });
	const name = uniqueName("Animaux");
	const renamed = uniqueName("Chat");

	await page.goto(PAGE);
	await page.getByRole("button", { name: "Ajouter une catégorie" }).click();
	const dialog = page.getByRole("dialog", { name: "Ajouter une catégorie" });
	await dialog.getByLabel("Nom").fill(name);
	await pick(dialog, "Rouge");
	await pick(dialog, "Chien");
	await dialog.getByRole("button", { name: "Ajouter une catégorie" }).click();
	await expect(page.getByText(`Catégorie « ${name} » ajoutée.`)).toBeVisible();

	await page.reload();
	await expect(row(group(page, "Dépenses"), name).locator("svg.lucide-dog")).toBeVisible();
	await expect(row(page, name).locator("span[aria-hidden]").first()).toHaveCSS(
		"background-color",
		"rgb(219, 90, 84)",
	);

	await openAction(page, name, "Modifier");
	const edit = page.getByRole("dialog", { name: "Modifier la catégorie" });
	await edit.getByLabel("Nom").fill(renamed);
	await pick(edit, "Bleu ciel");
	await edit.getByRole("button", { name: "Enregistrer" }).click();
	await expect(page.getByText(`Catégorie « ${renamed} » enregistrée.`)).toBeVisible();

	await page.reload();
	await expect(row(page, name)).toHaveCount(0);
	await expect(row(page, renamed).locator("span[aria-hidden]").first()).toHaveCSS(
		"background-color",
		"rgb(97, 201, 234)",
	);

	await openAction(page, renamed, "Modifier");
	await edit.getByRole("combobox", { name: "Catégorie parente" }).click();
	await page.getByRole("option", { name: parent.name }).click();
	// A child takes its parent's type and colour, so the form stops offering them.
	await expect(edit.getByRole("group", { name: "Couleur" })).toHaveCount(0);
	await expect(edit.getByRole("combobox", { name: "Type" })).toHaveCount(0);
	await edit.getByRole("button", { name: "Enregistrer" }).click();
	await expect(page.getByText(`Catégorie « ${renamed} » enregistrée.`)).toBeVisible();

	await page.reload();
	const parentItem = page.getByRole("listitem").filter({ has: row(page, parent.name) });
	await expect(row(parentItem.getByRole("list"), renamed)).toBeVisible();
	await expect(row(page, renamed).locator("span[aria-hidden]").first()).toHaveCSS(
		"background-color",
		"rgb(77, 165, 104)",
	);
});

test("the delete dialog shows the transaction count and where they can go", async ({
	page,
	api,
}) => {
	const account = await api.openAccount();
	const source = await api.createCategory({ name: uniqueName("Sorties") });
	const replacement = await api.createCategory({ name: uniqueName("Loisirs") });
	const ids = [
		await api.addTransaction(account.id, { date: daysAgo(2), label: "Cinéma", amount: "-12" }),
		await api.addTransaction(account.id, { date: daysAgo(3), label: "Concert", amount: "-40" }),
	];
	await api.categorise(ids, source.id);

	await page.goto(PAGE);
	await expect(row(page, source.name)).toContainText("2 opérations");
	await openAction(page, source.name, "Supprimer");
	const dialog = page.getByRole("dialog", { name: `Supprimer la catégorie « ${source.name} » ?` });
	await expect(dialog).toContainText("Elle contient 2 opérations.");
	const destination = dialog.getByRole("combobox", { name: "Déplacer les opérations vers" });
	await expect(destination).toHaveText("Laisser sans catégorie");
	await destination.click();
	await expect(page.getByRole("option", { name: "Laisser sans catégorie" })).toBeVisible();
	await page.getByRole("option", { name: replacement.name }).click();
	await dialog.getByRole("button", { name: "Supprimer" }).click();

	await expect(page.getByText(`Catégorie « ${source.name} » supprimée.`)).toBeVisible();
	await expect(row(page, source.name)).toHaveCount(0);
	await expect(row(page, replacement.name)).toContainText("2 opérations");
});

test("an unused category is deleted with no destination to choose", async ({ page, api }) => {
	const unused = await api.createCategory({ name: uniqueName("Inutile") });

	await page.goto(PAGE);
	await openAction(page, unused.name, "Supprimer");
	const dialog = page.getByRole("dialog", { name: `Supprimer la catégorie « ${unused.name} » ?` });
	await expect(dialog).toContainText("Elle ne contient aucune opération.");
	await expect(dialog.getByRole("combobox")).toHaveCount(0);
	await dialog.getByRole("button", { name: "Supprimer" }).click();

	await expect(page.getByText(`Catégorie « ${unused.name} » supprimée.`)).toBeVisible();
	await expect(row(page, unused.name)).toHaveCount(0);
});

test("merging moves the source's transactions into the target and removes the source", async ({
	page,
	api,
}) => {
	const account = await api.openAccount();
	const source = await api.createCategory({ name: uniqueName("Resto") });
	const target = await api.createCategory({ name: uniqueName("Repas"), kind: "income" });
	await api.categorise(
		[
			await api.addTransaction(account.id, { date: daysAgo(2), label: "Pizzeria", amount: "-18" }),
			await api.addTransaction(account.id, { date: daysAgo(4), label: "Brasserie", amount: "-25" }),
		],
		source.id,
	);
	await api.categorise(
		[await api.addTransaction(account.id, { date: daysAgo(5), label: "Traiteur", amount: "-9" })],
		target.id,
	);

	await page.goto(PAGE);
	await expect(row(page, target.name)).toContainText("1 opération");
	await openAction(page, source.name, "Fusionner");
	const dialog = page.getByRole("dialog", {
		name: `Fusionner « ${source.name} » dans une autre catégorie`,
	});
	await expect(dialog.getByRole("button", { name: "Fusionner" })).toBeDisabled();
	await dialog.getByRole("combobox", { name: "Fusionner dans" }).click();
	await page.getByRole("option", { name: target.name }).click();
	await dialog.getByRole("button", { name: "Fusionner" }).click();

	await expect(
		page.getByText(`« ${source.name} » fusionnée dans « ${target.name} ».`),
	).toBeVisible();
	await expect(row(page, source.name)).toHaveCount(0);
	await expect(row(page, target.name)).toContainText("3 opérations");
});
