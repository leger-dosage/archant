import type { Page } from "@playwright/test";

import { adjustToContrast } from "../src/lib/contrast.ts";
import { daysAgo, expect, rgb, test } from "./fixtures.ts";

// Story 12.1: the brand foundation, Linear's skin over Sure's content.

const sidebar = (page: Page) => page.locator('[data-sidebar="sidebar"]');

const panel = (page: Page) => page.locator('[data-slot="sidebar-inset"]');

/** The 44 px bar that holds the page's `h1` and its actions. */
const titleBar = (page: Page, title: string) =>
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

test("the sidebar shows the logo, an icon on each entry and each account's type icon", async ({
	page,
	api,
}) => {
	const checking = await api.openAccount({ openingDate: daysAgo(5) });
	const card = await api.openAccount({ kind: "credit_card", openingDate: daysAgo(5) });

	await page.goto("/");
	await expect(sidebar(page).getByRole("img", { name: "Archant" })).toBeVisible();

	await Promise.all(
		(
			[
				["Tableau de bord", "layout-dashboard"],
				["Comptes", "wallet"],
				["Opérations", "receipt"],
				["Récurrences", "calendar"],
				["Règles", "funnel"],
			] as const
		).map(([name, icon]) =>
			expect(
				sidebar(page).getByRole("link", { name, exact: true }).locator(`svg.lucide-${icon}`),
			).toBeVisible(),
		),
	);

	await expect(
		sidebar(page)
			.getByRole("link", { name: new RegExp(checking.name) })
			.locator("svg.lucide-landmark"),
	).toBeVisible();
	await expect(
		sidebar(page)
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
				["Sécurité", "shield-check"],
			] as const
		).map(([name, icon]) =>
			expect(nav.getByRole("link", { name }).locator(`svg.lucide-${icon}`)).toBeVisible(),
		),
	);
});

test("the title bar holds the page's icon, its h1 and its actions", async ({ page }) => {
	await page.goto("/recurring");
	const bar = titleBar(page, "Récurrences");

	await expect(bar.locator("svg.lucide-calendar")).toBeVisible();
	await expect(bar.getByRole("button", { name: "Détecter" })).toBeVisible();
	await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

	await page.goto("/settings/security");
	await expect(titleBar(page, "Réglages")).toBeVisible();
	await expect(page.getByRole("heading", { level: 2, name: "Sécurité" })).toBeVisible();
});

test("Inter sets the text, and the inset panel has a border and no shadow", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByRole("heading", { level: 1, name: "Tableau de bord" })).toBeVisible();

	const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
	expect(font.replaceAll('"', "")).toMatch(/^Inter Variable/u);
	await expect(page.locator("body")).toHaveCSS("font-size", "13px");
	await expect(page.locator("html")).toHaveCSS("font-feature-settings", '"cv01", "ss03"');
	await expect(panel(page)).toHaveCSS("box-shadow", "none");
	await expect(panel(page)).toHaveCSS("border-top-width", "1px");
	await expect(panel(page)).toHaveCSS("background-color", "rgb(255, 255, 255)");
});

test("« Thème : Sombre » turns the panel to Classic Dark's charcoal and recolours the icons", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingDate: daysAgo(5) });
	const typeIcon = sidebar(page)
		.getByRole("link", { name: new RegExp(account.name) })
		.locator('[data-slot="tinted-icon"]');
	const depository = "#9d6fe8";

	await page.goto("/");
	await expect(typeIcon).toHaveCSS("color", rgb(adjustToContrast(depository, "#f4f4f4", 3)));
	const fill = () => typeIcon.evaluate((element) => getComputedStyle(element).backgroundColor);
	const lightFill = await fill();
	await sidebar(page)
		.getByRole("button", { name: /^Thème : / })
		.click();
	await page.getByRole("menuitemradio", { name: "Sombre" }).click();

	await expect(sidebar(page).getByRole("button", { name: "Thème : Sombre" })).toBeVisible();
	await expect(panel(page)).toHaveCSS("background-color", "rgb(31, 32, 35)");
	// No reload: the icon follows the theme on screen, its tint 17 % instead of 10 %.
	await expect(typeIcon).toHaveCSS("color", rgb(adjustToContrast(depository, "#2b2d30", 3)));
	await expect.poll(fill).not.toBe(lightFill);
});
