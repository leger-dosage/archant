import type { Page } from "@playwright/test";

import { expect, rgb, test } from "./fixtures.ts";

// Story 12.4: the pages outside the app shell show the arch on DESIGN.md's
// base background, the page in a bordered box on the panel colour. Signed
// out, since a session would send sign-in and setup to the dashboard.

test.use({ storageState: { cookies: [], origins: [] } });

const MODES = {
	light: { base: "#f8f8f8", panel: "#ffffff" },
	dark: { base: "#1a1b1e", panel: "#1f2023" },
} as const;

async function expectOutsideShell(page: Page, heading: string, mode: keyof typeof MODES) {
	await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
	const logo = page.getByRole("img", { name: "Archant", exact: true });
	await expect(logo).toBeVisible();
	await expect(logo).toHaveCSS("width", "32px");
	await expect(page.getByRole("main")).toHaveCSS("background-color", rgb(MODES[mode].base));

	const box = page.locator('[data-slot="outside-shell-box"]');
	await expect(box).toHaveCSS("background-color", rgb(MODES[mode].panel));
	await expect(box).toHaveCSS("border-top-width", "1px");
	await expect(box).toHaveCSS("border-radius", "10px");
	await expect(box).toHaveCSS("box-shadow", "none");
	await expect(box.getByRole("heading", { level: 1, name: heading })).toBeVisible();
}

for (const mode of ["light", "dark"] as const) {
	test.describe(`in ${mode} mode`, () => {
		test.use({ colorScheme: mode });

		test("sign-in shows the logo above its box", async ({ page }) => {
			await page.goto("/sign-in");

			await expectOutsideShell(page, "Connexion", mode);
			await expect(page.getByRole("button", { name: "Se connecter" })).toBeVisible();
		});

		test("setup shows the logo above its box", async ({ page }) => {
			// A fresh database's answer: the administrator already exists here.
			await page.route("**/api/setup", (route) =>
				route.request().method() === "GET"
					? route.fulfill({ json: { data: { open: true } } })
					: route.continue(),
			);

			await page.goto("/setup");

			await expectOutsideShell(page, "Créer le compte administrateur", mode);
			await expect(page.getByRole("button", { name: "Créer le compte" })).toBeVisible();
		});

		test("the root error page shows the logo above its box", async ({ page }) => {
			await page.route("**/api/setup", (route) =>
				route.fulfill({
					status: 500,
					json: { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
				}),
			);

			await page.goto("/");

			await expectOutsideShell(page, "Une erreur est survenue", mode);
			await expect(page.getByRole("button", { name: "Réessayer" })).toBeVisible();
		});
	});
}
