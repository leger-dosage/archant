import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures.ts";

// Story 11.9: a first start that says what is wrong. The API is made to fail
// from the browser's side, the one place a test can take it away without
// stopping the server every other spec shares.

const apiDownHeading = (page: Page) =>
	page.getByRole("heading", { level: 1, name: "L'API ne répond pas" });

async function expectApiDownPage(page: Page) {
	// Within the default five seconds: the session is not retried, so the page
	// does not wait out the seven seconds of backoff.
	await expect(apiDownHeading(page)).toBeVisible();
	await expect(page.getByText("pnpm api start:dev")).toBeVisible();
	await expect(page.getByText("la variable PORT de .env")).toBeVisible();
	await expect(page.getByText("NETWORK_ERROR", { exact: true })).toHaveCount(0);
	// Without the sidebar: its links would lead to pages that fail the same way.
	await expect(page.getByRole("link", { name: "Comptes" })).toHaveCount(0);
}

test("an API that does not answer shows how to start it, then the page once it is back", async ({
	page,
}) => {
	await page.route("**/api/**", (route) => route.abort("connectionrefused"));

	await page.goto("/");

	await expectApiDownPage(page);

	await page.unroute("**/api/**");
	await page.getByRole("button", { name: "Réessayer" }).click();

	await expect(page.getByRole("heading", { level: 1, name: "Tableau de bord" })).toBeVisible();
	await expect(apiDownHeading(page)).toHaveCount(0);
});

test("another server answering on the API's port shows the same page", async ({ page }) => {
	await page.route("**/api/**", (route) =>
		route.fulfill({
			status: 404,
			contentType: "text/html",
			body: "<!doctype html><title>Not found</title><h1>Not found</h1>",
		}),
	);

	await page.goto("/accounts");

	await expectApiDownPage(page);
});

test.describe("signed out", () => {
	test.use({ storageState: { cookies: [], origins: [] } });

	test("any other failure before a page loads is explained, not shown as a code", async ({
		page,
	}) => {
		await page.route("**/api/setup", (route) =>
			route.fulfill({
				status: 500,
				json: { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
			}),
		);

		await page.goto("/");

		await expect(
			page.getByRole("heading", { level: 1, name: "Une erreur est survenue" }),
		).toBeVisible();
		await expect(
			page.getByText("Une erreur inattendue s'est produite. Réessayez dans un instant."),
		).toBeVisible();
		await expect(page.getByText("INTERNAL_ERROR", { exact: true })).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Réessayer" })).toBeVisible();
	});
});
