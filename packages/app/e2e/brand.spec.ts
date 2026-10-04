import type { Page } from "@playwright/test";

import { adjustToContrast } from "../src/lib/contrast.ts";
import { daysAgo, expect, rgb, test } from "./fixtures.ts";
import { ADMIN_FIRST_NAME } from "./settings.ts";

// Story 12.1: the brand foundation, Linear's skin over Sure's content.

const rail = (page: Page) => page.getByRole("navigation", { name: "Navigation principale" });

const column = (page: Page) => page.getByRole("complementary", { name: "Liste des comptes" });

/** The page header that holds the page's `h1` and its actions. */
const pageHeader = (page: Page, title: string) =>
	page.getByRole("heading", { level: 1, name: title }).locator("..");

test("the favicon links answer, the SVG and its PNG fallback", async ({ page, request }) => {
	await page.goto("/");

	await Promise.all(
		(
			[
				["/favicon.svg", "image/svg+xml"],
				["/favicon-32.png", "image/png"],
			] as const
		).map(async ([href, type]) => {
			await expect(page.locator(`link[rel="icon"][href="${href}"]`)).toHaveCount(1);
			const response = await request.get(href);
			expect(response.status(), href).toBe(200);
			// An unknown path answers 200 too, with index.html; the type tells them apart.
			expect(response.headers()["content-type"], href).toContain(type);
		}),
	);
});

test("the rail shows the logo and an icon on each entry, the accounts column each account's type icon", async ({
	page,
	api,
}) => {
	const checking = await api.openAccount({ openingDate: daysAgo(5) });
	const card = await api.openAccount({ kind: "credit_card", openingDate: daysAgo(5) });

	await page.goto("/");
	await expect(page.getByRole("img", { name: "Archant" })).toHaveCSS("width", "28px");

	await Promise.all(
		(
			[
				["Accueil", "layout-dashboard"],
				["Opérations", "receipt"],
				["Comptes", "wallet"],
				["Budgets", "piggy-bank"],
				["Objectifs", "goal"],
				["Récurrent", "calendar"],
				["Règles", "funnel"],
				["Réglages", "settings"],
			] as const
		).map(([name, icon]) =>
			expect(
				rail(page).getByRole("link", { name, exact: true }).locator(`svg.lucide-${icon}`),
			).toBeVisible(),
		),
	);

	await expect(
		column(page)
			.getByRole("link", { name: new RegExp(checking.name) })
			.locator("svg.lucide-landmark"),
	).toBeVisible();
	await expect(
		column(page)
			.getByRole("link", { name: new RegExp(card.name) })
			.locator("svg.lucide-credit-card"),
	).toBeVisible();
});

test("each settings entry has its icon", async ({ page }) => {
	await page.goto("/settings/categories");
	const nav = page.getByRole("navigation", { name: "Réglages" });

	await Promise.all(
		(
			[
				["Banques", "banknote"],
				["Catégories", "shapes"],
				["Marchands", "store"],
				["Étiquettes", "tags"],
				["Membres", "users"],
				["Sécurité", "shield-check"],
			] as const
		).map(([name, icon]) =>
			expect(nav.getByRole("link", { name }).locator(`svg.lucide-${icon}`)).toBeVisible(),
		),
	);
});

test("the page header holds its h1 and its actions", async ({ page, api }) => {
	// A series to list: an empty list moves « Détecter » into its empty state.
	const account = await api.openAccount({ openingDate: daysAgo(5) });
	await api.addRecurring(
		await api.addTransaction(account.id, {
			date: daysAgo(1),
			label: "Abonnement",
			amount: "-9,99",
		}),
	);
	await page.goto("/recurring");
	const header = pageHeader(page, "Récurrences");

	await expect(header.getByRole("button", { name: "Détecter" })).toBeVisible();
	await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

	// A settings section is its own page: its name is the `h1`, as in Sure.
	await page.goto("/settings/security");
	await expect(pageHeader(page, "Sécurité")).toBeVisible();
	await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
	await expect(page.getByRole("heading", { level: 2, name: "Mot de passe" })).toBeVisible();
});

test("Inter sets the text at 14 px, and the page sits on the base background with 1px lines", async ({
	page,
}) => {
	await page.goto("/");
	await expect(
		page.getByRole("heading", { level: 1, name: `Bonjour ${ADMIN_FIRST_NAME}` }),
	).toBeVisible();

	const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
	expect(font.replaceAll('"', "")).toMatch(/^Inter Variable/u);
	await expect(page.locator("body")).toHaveCSS("font-size", "14px");
	await expect(page.locator("html")).toHaveCSS("font-feature-settings", '"cv01", "ss03"');
	await expect(page.locator("body")).toHaveCSS("background-color", "rgb(248, 248, 248)");
	const topBar = page.locator('[data-slot="top-bar"]');
	await expect(topBar).toHaveCSS("border-bottom-width", "1px");
	await expect(topBar).toHaveCSS("box-shadow", "none");
});

test("« Sombre » turns the page to Classic Dark's charcoal and recolours the icons", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingDate: daysAgo(5) });
	const typeIcon = column(page)
		.getByRole("link", { name: new RegExp(account.name) })
		.locator('[data-slot="tinted-icon"]');
	const depository = "#9d6fe8";

	await page.goto("/");
	await expect(typeIcon).toHaveCSS("color", rgb(adjustToContrast(depository, "#f4f4f4", 3)));
	const fill = () => typeIcon.evaluate((element) => getComputedStyle(element).backgroundColor);
	const lightFill = await fill();
	await page.getByRole("button", { name: "admin@archant.test" }).click();
	await page.getByRole("menuitemradio", { name: "Sombre" }).click();

	await expect(page.locator("body")).toHaveCSS("background-color", "rgb(26, 27, 30)");
	// No reload: the icon follows the theme on screen, its tint 17 % instead of 10 %.
	await expect(typeIcon).toHaveCSS("color", rgb(adjustToContrast(depository, "#2b2d30", 3)));
	await expect.poll(fill).not.toBe(lightFill);

	await page.getByRole("button", { name: "admin@archant.test" }).click();
	await expect(page.getByRole("menuitemradio", { name: "Sombre" })).toHaveAttribute(
		"aria-checked",
		"true",
	);
});
