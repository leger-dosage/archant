import type { Locator, Page } from "@playwright/test";

import { adjustToContrast } from "../src/lib/contrast.ts";
import { daysAgo, expect, rgb, test, uniqueName } from "./fixtures.ts";

// Story 4.1: default categories and category management. One database serves
// the whole run, so each test works on categories of its own and never
// changes a default.

const PAGE = "/settings/categories";

/** A category's row: its tinted icon, name, count and menu. */
const row = (scope: Page | Locator, name: string) =>
	scope.getByRole("button", { name: `Actions pour ${name}`, exact: true }).locator("..");

/** The page's one list, as Sure's since #1160: no income or expense group. */
const list = (page: Page) => page.getByRole("region", { name: "Catégories", exact: true });

/** Picks a swatch or an icon by clicking its label, as a pointer does: the radio itself is hidden. */
async function pick(dialog: Locator, name: string) {
	const radio = dialog.page().getByRole("radio", { name, exact: true });
	await dialog.locator("label", { has: radio }).click();
	await expect(dialog.getByRole("radio", { name, exact: true })).toBeChecked();
}

async function openAction(page: Page, name: string, action: "Modifier" | "Supprimer") {
	await page.getByRole("button", { name: `Actions pour ${name}`, exact: true }).click();
	await page.getByRole("menuitem", { name: action }).click();
}

/** Sure's `Category::COLORS`, in the order the form offers them, then its custom colour. */
const SWATCHES = [
	"Orange",
	"Vert",
	"Bleu",
	"Rouge",
	"Rose",
	"Mauve",
	"Vermillon",
	"Bleu ciel",
	"Violet",
	"Vert clair",
	"Couleur personnalisée",
];

/** The dialog's live tinted icon of the category being edited. */
const preview = (dialog: Locator) =>
	dialog.getByRole("img", { name: "Aperçu de la catégorie" }).locator('[data-slot="tinted-icon"]');

/** A tinted icon's colour in light mode: the category's, adjusted to 3:1 on the hover row. */
const iconColor = (hex: string) => rgb(adjustToContrast(hex, "#f4f4f4", 3));

/** Sure's 22 `default_categories`, Archant's French names for the fifteen it had. */
const DEFAULTS = [
	"Revenus",
	"Restaurants",
	"Courses",
	"Achats",
	"Transports",
	"Voyages",
	"Loisirs",
	"Santé",
	"Soins personnels",
	"Amélioration de l'habitat",
	"Logement",
	"Énergie et eau",
	"Abonnements",
	"Assurances",
	"Sports et remise en forme",
	"Cadeaux et dons",
	"Impôts et taxes",
	"Paiements du prêt",
	"Prestations",
	"Frais bancaires",
	"Épargne et placements",
	"Contributions aux investissements",
];

test("a fresh instance lists the defaults in one list, each with its colour and icon", async ({
	page,
}) => {
	await page.goto(PAGE);
	await expect(page.getByRole("heading", { level: 1, name: "Catégories" })).toBeVisible();
	await expect(page.getByRole("region", { name: "Revenus", exact: true })).toHaveCount(0);
	await expect(page.getByRole("region", { name: "Dépenses", exact: true })).toHaveCount(0);

	const categories = list(page);
	await expect(row(categories, "Revenus").locator('[data-slot="tinted-icon"]')).toHaveCSS(
		"color",
		iconColor("#22c55e"),
	);
	await expect(row(categories, "Revenus").locator("svg.lucide-circle-dollar-sign")).toBeVisible();

	const names = await categories
		.getByRole("button", { name: /^Actions pour / })
		.evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")));
	expect(names).toEqual(expect.arrayContaining(DEFAULTS.map((name) => `Actions pour ${name}`)));
	await expect(row(categories, "Courses").locator('[data-slot="tinted-icon"]')).toHaveCSS(
		"color",
		iconColor("#407706"),
	);
	await expect(row(categories, "Courses").locator("svg.lucide-shopping-bag")).toBeVisible();
	await expect(
		row(categories, "Contributions aux investissements").locator("svg.lucide-trending-up"),
	).toBeVisible();

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
	// No « Type » since Sure's #1160: a category takes any line and any budget.
	await expect(dialog.getByRole("combobox", { name: "Type" })).toHaveCount(0);
	await dialog.getByLabel("Nom").fill(name);
	const swatches = dialog.getByRole("group", { name: "Couleur" }).getByRole("radio");
	await expect(swatches).toHaveCount(SWATCHES.length);
	expect(
		await swatches.evaluateAll((radios) =>
			radios.map((radio) => radio.parentElement?.textContent ?? ""),
		),
	).toEqual(SWATCHES);
	// One of the ten at random, as Sure's `COLORS.sample`.
	await expect(swatches.and(page.locator(":checked"))).toHaveCount(1);
	await expect(swatches.last()).not.toBeChecked();
	await pick(dialog, "Rouge");
	await pick(dialog, "Chien");
	await expect(preview(dialog).locator("svg.lucide-dog")).toBeVisible();
	await expect(preview(dialog)).toHaveCSS("color", iconColor("#db5a54"));
	await dialog.getByRole("button", { name: "Ajouter une catégorie" }).click();
	await expect(page.getByText(`Catégorie « ${name} » ajoutée.`)).toBeVisible();

	await page.reload();
	await expect(row(list(page), name).locator("svg.lucide-dog")).toBeVisible();
	await expect(row(page, name).locator('[data-slot="tinted-icon"]')).toHaveCSS(
		"color",
		iconColor("#db5a54"),
	);

	await openAction(page, name, "Modifier");
	const edit = page.getByRole("dialog", { name: "Modifier la catégorie" });
	await edit.getByLabel("Nom").fill(renamed);
	await pick(edit, "Bleu");
	await edit.getByRole("button", { name: "Enregistrer" }).click();
	await expect(page.getByText(`Catégorie « ${renamed} » enregistrée.`)).toBeVisible();

	await page.reload();
	await expect(row(page, name)).toHaveCount(0);
	await expect(row(page, renamed).locator('[data-slot="tinted-icon"]')).toHaveCSS(
		"color",
		iconColor("#6471eb"),
	);

	await openAction(page, renamed, "Modifier");
	await edit.getByRole("combobox", { name: "Catégorie parente" }).click();
	await page.getByRole("option", { name: parent.name }).click();
	await expect(preview(edit)).toHaveCSS("color", iconColor("#4da568"));
	// A child takes its parent's colour, so the form stops offering it.
	await expect(edit.getByRole("group", { name: "Couleur" })).toHaveCount(0);
	await edit.getByRole("button", { name: "Enregistrer" }).click();
	await expect(page.getByText(`Catégorie « ${renamed} » enregistrée.`)).toBeVisible();

	await page.reload();
	const parentItem = page.getByRole("listitem").filter({ has: row(page, parent.name) });
	await expect(row(parentItem.getByRole("list"), renamed)).toBeVisible();
	await expect(row(page, renamed).locator('[data-slot="tinted-icon"]')).toHaveCSS(
		"color",
		iconColor("#4da568"),
	);
});

test("a default's colour outside the ten shows as Sure's custom colour, previewed", async ({
	page,
}) => {
	await page.goto(PAGE);
	await openAction(page, "Revenus", "Modifier");
	const edit = page.getByRole("dialog", { name: "Modifier la catégorie" });
	const swatches = edit.getByRole("group", { name: "Couleur" }).getByRole("radio");

	await expect(swatches).toHaveCount(SWATCHES.length);
	await expect(edit.getByRole("radio", { name: "Couleur personnalisée" })).toBeChecked();
	await expect(edit.getByRole("textbox", { name: "Code de la couleur" })).toHaveValue("#22c55e");
	await expect(preview(edit)).toHaveCSS("color", iconColor("#22c55e"));
	await expect(preview(edit).locator("svg.lucide-circle-dollar-sign")).toBeVisible();
	// An untouched colour is never refused, even one Sure would warn about.
	await expect(edit.getByText("Mauvais contraste")).toHaveCount(0);

	// Closed without saving: the defaults stay as they are for every other test.
	await edit.getByRole("button", { name: "Annuler" }).click();
	await expect(edit).toBeHidden();
});

test("a category keeps its own pale colour through a rename, never refused for contrast", async ({
	page,
	api,
}) => {
	const own = await api.createCategory({ name: uniqueName("Vert"), color: "#22c55e" });
	const renamed = uniqueName("Prairie");

	await page.goto(PAGE);
	await openAction(page, own.name, "Modifier");
	const edit = page.getByRole("dialog", { name: "Modifier la catégorie" });
	await edit.getByLabel("Nom").fill(renamed);
	await edit.getByRole("button", { name: "Enregistrer" }).click();

	await expect(page.getByText(`Catégorie « ${renamed} » enregistrée.`)).toBeVisible();
	await expect(row(page, renamed).locator('[data-slot="tinted-icon"]')).toHaveCSS(
		"color",
		iconColor("#22c55e"),
	);
});

test("a pale custom colour warns of poor contrast and saves once adjusted", async ({ page }) => {
	const name = uniqueName("Pâle");

	await page.goto(PAGE);
	await page.getByRole("button", { name: "Ajouter une catégorie" }).click();
	const dialog = page.getByRole("dialog", { name: "Ajouter une catégorie" });
	await dialog.getByLabel("Nom").fill(name);
	await pick(dialog, "Couleur personnalisée");
	const code = dialog.getByRole("textbox", { name: "Code de la couleur" });
	await code.fill("#f5f5f5");
	await expect(dialog).toContainText("Mauvais contraste, choisissez une couleur plus foncée ou");
	await dialog.getByRole("button", { name: "Ajouter une catégorie" }).click();
	await expect(
		dialog.getByText("Mauvais contraste, choisissez une couleur plus foncée."),
	).toBeVisible();

	await dialog.getByRole("button", { name: "réglage automatique." }).click();
	await expect(dialog.getByText("Mauvais contraste")).toHaveCount(0);
	const adjusted = await code.inputValue();
	expect(adjusted).toMatch(/^#[0-9a-f]{6}$/u);
	expect(adjusted).not.toBe("#f5f5f5");
	await dialog.getByRole("button", { name: "Ajouter une catégorie" }).click();
	await expect(page.getByText(`Catégorie « ${name} » ajoutée.`)).toBeVisible();
	await expect(row(page, name).locator('[data-slot="tinted-icon"]')).toHaveCSS(
		"color",
		iconColor(adjusted),
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

test("« Fusionner les catégories » moves several sources into a target and removes them", async ({
	page,
	api,
}) => {
	const account = await api.openAccount();
	const source = await api.createCategory({ name: uniqueName("Resto") });
	const other = await api.createCategory({ name: uniqueName("Bar") });
	const target = await api.createCategory({ name: uniqueName("Repas") });
	await api.categorise(
		[
			await api.addTransaction(account.id, { date: daysAgo(2), label: "Pizzeria", amount: "-18" }),
			await api.addTransaction(account.id, { date: daysAgo(4), label: "Brasserie", amount: "-25" }),
		],
		source.id,
	);
	await api.categorise(
		[await api.addTransaction(account.id, { date: daysAgo(3), label: "Apéritif", amount: "-7" })],
		other.id,
	);
	await api.categorise(
		[await api.addTransaction(account.id, { date: daysAgo(5), label: "Traiteur", amount: "-9" })],
		target.id,
	);

	await page.goto(PAGE);
	await expect(row(page, target.name)).toContainText("1 opération");
	// Sure's row menu has no merge: the page's menu merges one or several.
	await page.getByRole("button", { name: `Actions pour ${source.name}`, exact: true }).click();
	await expect(page.getByRole("menuitem", { name: "Fusionner" })).toHaveCount(0);
	await page.keyboard.press("Escape");

	await page.getByRole("button", { name: "Plus d'actions sur les catégories" }).click();
	await page.getByRole("menuitem", { name: "Fusionner les catégories" }).click();
	const dialog = page.getByRole("dialog", { name: "Fusionner les catégories" });
	const submit = dialog.getByRole("button", { name: "Fusionner la sélection" });
	await expect(submit).toBeDisabled();
	await dialog.getByRole("combobox", { name: "Fusionner dans (cible)" }).click();
	await page.getByRole("option", { name: target.name, exact: true }).click();
	const sources = dialog.getByRole("group", { name: "Catégories à fusionner" });
	await expect(sources.getByRole("checkbox", { name: target.name, exact: true })).toBeDisabled();
	await sources.getByRole("checkbox", { name: source.name, exact: true }).check();
	await sources.getByRole("checkbox", { name: other.name, exact: true }).check();
	await submit.click();

	await expect(page.getByText(`2 catégories fusionnées dans « ${target.name} ».`)).toBeVisible();
	await expect(dialog).toBeHidden();
	await expect(row(page, source.name)).toHaveCount(0);
	await expect(row(page, other.name)).toHaveCount(0);
	await expect(row(page, target.name)).toContainText("4 opérations");
});

test("« Fusionner les catégories » refuses a parent into its own subcategory", async ({
	page,
	api,
}) => {
	const parent = await api.createCategory({ name: uniqueName("Maison") });
	const child = await api.createCategory({ name: uniqueName("Loyer"), parentId: parent.id });

	await page.goto(PAGE);
	await page.getByRole("button", { name: "Plus d'actions sur les catégories" }).click();
	await page.getByRole("menuitem", { name: "Fusionner les catégories" }).click();
	const dialog = page.getByRole("dialog", { name: "Fusionner les catégories" });
	await dialog.getByRole("combobox", { name: "Fusionner dans (cible)" }).click();
	await page.getByRole("option", { name: `${parent.name} > ${child.name}`, exact: true }).click();
	await dialog
		.getByRole("group", { name: "Catégories à fusionner" })
		.getByRole("checkbox", { name: parent.name, exact: true })
		.check();
	await dialog.getByRole("button", { name: "Fusionner la sélection" }).click();

	await expect(dialog.getByRole("alert")).toHaveText(
		"Impossible entre une catégorie et sa sous-catégorie.",
	);
	await dialog.getByRole("button", { name: "Annuler" }).click();
	await expect(row(page, parent.name)).toBeVisible();
});
