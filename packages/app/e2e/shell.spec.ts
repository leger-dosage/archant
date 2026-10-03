import type { Page } from "@playwright/test";

import { daysAgo, euros, expect, test } from "./fixtures.ts";

// Story 14.1: Sure's shell at Sure's scale. The rail of destinations, the
// accounts column, the top bar with breadcrumbs and the page header; below
// 1024 px a top bar, a bottom navigation and the column in a sheet.

test.use({ viewport: { width: 1440, height: 900 } });

const rail = (page: Page) => page.getByRole("navigation", { name: "Navigation principale" });

const column = (page: Page) => page.getByRole("complementary", { name: "Liste des comptes" });

const breadcrumbs = (page: Page) => page.getByRole("navigation", { name: "Fil d'Ariane" });

const DESTINATIONS = [
	"Accueil",
	"Opérations",
	"Comptes",
	"Budgets",
	"Récurrent",
	"Règles",
	"Réglages",
];

/** A summary as `/api/accounts` answers it. */
const summary = (
	id: string,
	name: string,
	type: string,
	subtype: string | null,
	balance: number,
	overrides: Record<string, unknown> = {},
) => ({
	id,
	name,
	type,
	subtype,
	currency: "EUR",
	balance,
	active: true,
	excludedFromReports: false,
	...overrides,
});

/** Answers `/api/accounts` with a fixed household, whatever the run's database holds. */
async function fixedAccounts(page: Page) {
	await page.route("**/api/accounts", (route) =>
		route.fulfill({
			json: {
				data: {
					reportingCurrency: "EUR",
					groups: [
						{
							classification: "asset",
							accounts: [
								summary("a1", "Compte joint", "depository", "checking", 100_000),
								summary("a2", "Livret A", "depository", "savings", 25_050),
								summary("a3", "Compte en dollars", "depository", "checking", 900_000, {
									currency: "USD",
								}),
								summary("a4", "Compte de côté", "depository", "checking", 700_000, {
									excludedFromReports: true,
								}),
								summary("a5", "Ancien compte", "depository", "checking", 300_000, {
									active: false,
								}),
								summary("a6", "Mon PEA", "investment", "pea", 1_000_000),
							],
							total: 1_125_050,
							excludedCount: 1,
						},
						{
							classification: "liability",
							accounts: [
								summary("l1", "Carte Visa", "credit_card", null, 30_000),
								summary("l2", "Prêt auto", "loan", "consumer", 500_000),
							],
							total: 530_000,
							excludedCount: 0,
						},
					],
				},
			},
		}),
	);
}

test("a signed-in page shows the rail, the accounts column and the top bar, at Sure's scale", async ({
	page,
}) => {
	await page.goto("/transactions");

	await expect(rail(page).getByRole("link")).toHaveText(DESTINATIONS);
	await expect(rail(page).getByRole("link", { name: "Opérations" })).toHaveAttribute(
		"aria-current",
		"page",
	);
	await expect(rail(page).locator('[aria-current="page"]')).toHaveCount(1);
	await expect(column(page)).toBeVisible();
	await expect(breadcrumbs(page)).toHaveText("Accueil/Opérations");
	await expect(breadcrumbs(page).getByRole("link", { name: "Accueil" })).toHaveAttribute(
		"href",
		"/",
	);

	const title = page.getByRole("heading", { level: 1, name: "Opérations" });
	await expect(title).toHaveCSS("font-size", "24px");
	await expect(page.locator("body")).toHaveCSS("font-size", "14px");
	await expect(page.locator('[data-slot="top-bar"]')).toHaveCSS("height", "69px");
});

test("the rail marks Comptes on /accounts only, and Réglages on every settings page", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingDate: daysAgo(5) });
	const current = rail(page).locator('[aria-current="page"]');

	await page.goto("/");
	await expect(current).toHaveText("Accueil");

	await page.goto("/accounts");
	await expect(current).toHaveText("Comptes");

	await page.goto(`/accounts/${account.id}`);
	await expect(page.getByRole("heading", { level: 1, name: account.name })).toBeVisible();
	await expect(current).toHaveCount(0);
	await expect(column(page).getByRole("link", { name: new RegExp(account.name) })).toHaveAttribute(
		"aria-current",
		"page",
	);
	await expect(breadcrumbs(page)).toHaveText(`Comptes/${account.name}`);

	await page.goto("/settings/tags");
	await expect(current).toHaveText("Réglages");
});

test("the avatar's menu holds the theme, Réglages and Se déconnecter", async ({ page }) => {
	await page.goto("/");
	await page.getByRole("button", { name: "admin@archant.test" }).click();

	const menu = page.getByRole("menu");
	await expect(menu.getByRole("menuitemradio")).toHaveText(["Système", "Clair", "Sombre"]);
	await expect(menu.getByRole("menuitem", { name: "Réglages" })).toBeVisible();
	await expect(menu.getByRole("menuitem", { name: "Se déconnecter" })).toBeVisible();

	await menu.getByRole("menuitem", { name: "Réglages" }).click();
	await expect(page).toHaveURL(/\/settings\/categories$/u);
});

test("the accounts column groups the active accounts by type, each with its total", async ({
	page,
}) => {
	await fixedAccounts(page);
	await page.goto("/transactions");

	const banks = column(page).getByRole("group", { name: "Comptes bancaires" });
	// The two euro accounts reported: the dollar one and the excluded one are
	// listed but not counted, and the inactive one is not listed.
	await expect(banks).toContainText(euros(125_050));
	await expect(
		banks.getByTitle("1 compte dans une autre devise n'est pas compté dans le total."),
	).toHaveText(euros(125_050));
	await expect(banks.getByRole("link")).toHaveCount(4);
	await expect(banks.getByRole("link", { name: /Ancien compte/u })).toHaveCount(0);
	const joint = banks.getByRole("link", { name: /Compte joint/u });
	await expect(joint).toContainText("Compte courant");
	await expect(joint).toContainText(euros(100_000));
	await expect(joint.locator('[data-slot="tinted-icon"] svg.lucide-landmark')).toBeVisible();

	await expect(column(page).getByRole("group")).toHaveText([
		/^Comptes bancaires/u,
		/^Investissement/u,
		/^Carte de crédit/u,
		/^Prêt/u,
	]);

	await column(page).getByRole("tab", { name: "Passifs" }).click();
	await expect(column(page).getByRole("group")).toHaveText([/^Carte de crédit/u, /^Prêt/u]);
	await expect(column(page).getByRole("group", { name: "Prêt" })).toContainText(euros(500_000));

	await column(page).getByRole("tab", { name: "Actifs" }).click();
	await expect(column(page).getByRole("group")).toHaveText([
		/^Comptes bancaires/u,
		/^Investissement/u,
	]);
});

test("a tab without accounts says so", async ({ page }) => {
	await page.route("**/api/accounts", (route) =>
		route.fulfill({
			json: {
				data: {
					reportingCurrency: "EUR",
					groups: [
						{
							classification: "asset",
							accounts: [summary("a1", "Compte joint", "depository", "checking", 100_000)],
							total: 100_000,
							excludedCount: 0,
						},
						{ classification: "liability", accounts: [], total: 0, excludedCount: 0 },
					],
				},
			},
		}),
	);
	await page.goto("/transactions");

	await column(page).getByRole("tab", { name: "Passifs" }).click();
	await expect(column(page).getByRole("group")).toHaveCount(0);
	await expect(column(page).getByText("Aucun compte.", { exact: true })).toBeVisible();
});

test("a household without accounts sees « Ajouter un compte » alone in the column", async ({
	page,
}) => {
	await page.route("**/api/accounts", (route) =>
		route.fulfill({
			json: {
				data: {
					reportingCurrency: "EUR",
					groups: [
						{ classification: "asset", accounts: [], total: 0, excludedCount: 0 },
						{ classification: "liability", accounts: [], total: 0, excludedCount: 0 },
					],
				},
			},
		}),
	);
	await page.goto("/transactions");

	await expect(column(page).getByRole("button", { name: "Ajouter un compte" })).toBeVisible();
	await expect(column(page).getByRole("tab")).toHaveCount(0);
	await expect(column(page).getByRole("link")).toHaveCount(0);

	await column(page).getByRole("button", { name: "Ajouter un compte" }).click();
	await expect(page.getByRole("dialog", { name: "Ajouter un compte" })).toBeVisible();
});

test("the folded accounts column stays folded after a reload", async ({ page }) => {
	await page.goto("/transactions");
	const fold = page.getByRole("button", { name: "Replier ou déplier la liste des comptes" });

	await expect(fold).toHaveAttribute("aria-expanded", "true");
	await fold.click();
	await expect(column(page)).toHaveCount(0);
	await expect(fold).toHaveAttribute("aria-expanded", "false");

	await page.reload();
	await expect(page.getByRole("heading", { level: 1, name: "Opérations" })).toBeVisible();
	await expect(column(page)).toHaveCount(0);

	await fold.click();
	await expect(column(page)).toBeVisible();
});

test("settings put their navigation in place of the accounts column", async ({ page }) => {
	await page.goto("/settings/categories");

	const nav = page.getByRole("navigation", { name: "Réglages" });
	await expect(nav.getByRole("link", { name: "Catégories" })).toHaveAttribute(
		"aria-current",
		"page",
	);
	await expect(column(page)).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Replier ou déplier la liste des comptes" }),
	).toHaveCount(0);
	await expect(breadcrumbs(page)).toHaveText("Réglages/Catégories");

	await nav.getByRole("link", { name: "Étiquettes" }).click();
	await expect(page).toHaveURL(/\/settings\/tags$/u);
	await expect(breadcrumbs(page)).toHaveText("Réglages/Étiquettes");
});

test("a settings section's title and actions top its content, in one 896 px column", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1920, height: 1080 });
	await page.goto("/settings/categories");

	const title = page.getByRole("heading", { level: 1, name: "Catégories" });
	await expect(title).toBeVisible();
	await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
	const header = title.locator("..");
	await expect(header.getByRole("button", { name: "Ajouter une catégorie" })).toBeVisible();
	// Story 14.4: the categories sit in one card, their groups inside it.
	const section = page
		.locator('[data-slot="list-card"]')
		.filter({ has: page.getByRole("region", { name: "Dépenses", exact: true }) });

	const headerBox = await header.boundingBox();
	const sectionBox = await section.boundingBox();
	const main = await page.getByRole("main").boundingBox();
	expect(headerBox?.width).toBe(896);
	expect(sectionBox?.x).toBe(headerBox?.x);
	expect(sectionBox?.width).toBe(896);
	// Centred in the main area, as Sure's `max-w-4xl mx-auto`.
	const left = (headerBox?.x ?? 0) - (main?.x ?? 0);
	const right = (main?.x ?? 0) + (main?.width ?? 0) - (headerBox?.x ?? 0) - 896;
	expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
});

test.describe("on a phone", () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test("the bottom navigation holds the seven destinations, and the menu opens the accounts column", async ({
		page,
	}) => {
		await fixedAccounts(page);
		await page.goto("/transactions");
		await expect(page.getByRole("heading", { level: 1, name: "Opérations" })).toBeVisible();

		const bottom = rail(page);
		await expect(bottom.getByRole("link")).toHaveText(DESTINATIONS);
		await expect(bottom).toHaveCSS("position", "fixed");
		await expect(column(page)).toHaveCount(0);
		await expect(breadcrumbs(page)).toHaveCount(0);

		const menu = page.getByRole("button", { name: "Ouvrir le menu" });
		await menu.click();
		const sheet = page.getByRole("dialog", { name: "Liste des comptes" });
		await expect(sheet.getByRole("complementary", { name: "Liste des comptes" })).toBeVisible();
		// Polled: the sheet slides in.
		await expect.poll(async () => Math.round((await sheet.boundingBox())?.width ?? 0)).toBe(390);

		await page.keyboard.press("Escape");
		await expect(sheet).toBeHidden();
		await expect(menu).toBeFocused();

		await menu.click();
		await sheet.getByRole("link", { name: /Compte joint/u }).click();
		await expect(sheet).toBeHidden();
		await expect(page).toHaveURL(/\/accounts\/a1$/u);
	});

	test("on a settings page the menu opens the settings navigation", async ({ page }) => {
		await page.goto("/settings/categories");
		await page.getByRole("button", { name: "Ouvrir le menu" }).click();

		const sheet = page.getByRole("dialog", { name: "Réglages" });
		await sheet
			.getByRole("navigation", { name: "Réglages" })
			.getByRole("link", { name: "Étiquettes" })
			.click();

		await expect(page).toHaveURL(/\/settings\/tags$/u);
		await expect(sheet).toBeHidden();
	});

	test("the top bar's avatar opens the user menu", async ({ page }) => {
		await page.goto("/transactions");
		await page.getByRole("button", { name: "admin@archant.test" }).click();

		const menu = page.getByRole("menu");
		await expect(menu.getByRole("menuitem", { name: "Réglages" })).toBeVisible();
		await expect(menu.getByRole("menuitem", { name: "Se déconnecter" })).toBeVisible();
	});

	test("the bottom navigation leads to each page", async ({ page }) => {
		await page.goto("/");
		await rail(page).getByRole("link", { name: "Règles" }).click();

		await expect(page).toHaveURL(/\/rules$/u);
		await expect(page.getByRole("heading", { level: 1, name: "Règles" })).toBeVisible();
		await expect(rail(page).getByRole("link", { name: "Règles" })).toHaveAttribute(
			"aria-current",
			"page",
		);
	});
});
