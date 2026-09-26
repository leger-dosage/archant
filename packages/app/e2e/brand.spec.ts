import type { Locator, Page } from "@playwright/test";

import { expect, test, uniqueName } from "./fixtures.ts";

// Story 12.1: the logo, the raised active entry, the account type icons, the
// settings icons and the favicon.

const sidebar = (page: Page) => page.locator('[data-sidebar="sidebar"]');

const style = (locator: Locator, property: "backgroundColor" | "boxShadow" | "color") =>
	locator.evaluate((element, name) => getComputedStyle(element)[name], property);

test("the sidebar shows the arch mark beside « Archant »", async ({ page }) => {
	await page.goto("/accounts");

	const header = page.locator('[data-sidebar="header"]');
	await expect(header.locator('svg[data-slot="logo"]')).toBeVisible();
	await expect(header).toHaveText("Archant");
});

test("the active entry is a white tile with the ring shadow", async ({ page }) => {
	await page.goto("/transactions");

	const active = sidebar(page).getByRole("link", { name: "Opérations", exact: true });
	await expect(active).toHaveAttribute("data-active", "true");
	expect(await style(active, "backgroundColor")).toBe("rgb(255, 255, 255)");
	expect(await style(active, "boxShadow")).not.toBe("none");

	const idle = sidebar(page).getByRole("link", { name: "Règles", exact: true });
	expect(await style(idle, "boxShadow")).toBe("none");
});

test("a checking account's row shows its type icon and caption", async ({ page, api }) => {
	const account = await api.openAccount({ name: uniqueName("Marque") });
	await page.goto("/accounts");

	const row = sidebar(page).getByRole("link", { name: new RegExp(account.name) });
	// The caption is the kind's label, as the account page prints it.
	await expect(row).toContainText("Compte courant");
	expect(await style(row.locator('[data-slot="tinted-icon"]'), "color")).toBe("rgb(135, 91, 247)");
});

test("each settings entry carries Sure's icon", async ({ page }) => {
	await page.goto("/settings/banks");

	const nav = page.getByRole("navigation", { name: "Réglages" });
	const icons = {
		Banques: "banknote",
		Catégories: "shapes",
		Marchands: "store",
		Étiquettes: "tags",
		Sécurité: "shield-check",
	};
	await Promise.all(
		Object.entries(icons).map(([name, icon]) =>
			expect(
				nav.getByRole("link", { name, exact: true }).locator(`svg.lucide-${icon}`),
			).toHaveCount(1),
		),
	);

	const active = nav.getByRole("link", { name: "Banques", exact: true });
	expect(await style(active, "backgroundColor")).toBe("rgb(255, 255, 255)");
	expect(await style(active, "boxShadow")).not.toBe("none");
});

test("the favicon is an SVG the server serves as one", async ({ page, request }) => {
	await page.goto("/accounts");

	const href = await page.locator('link[rel="icon"][type="image/svg+xml"]').getAttribute("href");
	expect(href).toBe("/favicon.svg");

	const response = await request.get(href ?? "");
	expect(response.status()).toBe(200);
	expect(response.headers()["content-type"]).toContain("image/svg+xml");
	expect(await response.text()).toContain("prefers-color-scheme");

	// The `*` fallback would answer a missing file with the page itself.
	const pngs = ["/favicon-32.png", "/apple-touch-icon.png"];
	const fallbacks = await Promise.all(pngs.map((png) => request.get(png)));
	for (const [index, fallback] of fallbacks.entries()) {
		expect(fallback.status(), pngs[index]).toBe(200);
		expect(fallback.headers()["content-type"], pngs[index]).toContain("image/png");
	}
});
