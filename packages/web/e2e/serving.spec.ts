import { expect, test } from "./fixtures.ts";

// Story 3.3: the API serves the built interface on its own port, as the
// container does.

test("reloading a deep link shows the page", async ({ page }) => {
	await page.goto("/comptes");
	await expect(page.getByRole("heading", { level: 1, name: "Comptes" })).toBeVisible();

	const reloaded = await page.reload();

	expect(reloaded?.status()).toBe(200);
	expect(reloaded?.headers()["cache-control"]).toBe("no-cache");
	await expect(page.getByRole("heading", { level: 1, name: "Comptes" })).toBeVisible();
});

test("an unknown API route answers JSON, not the interface", async ({ page }) => {
	const response = await page.goto("/api/nope");

	expect(response?.status()).toBe(404);
	expect(response?.headers()["content-type"]).toContain("application/json");
	expect(await response?.json()).toEqual({
		error: { code: "NOT_FOUND", message: "No route matches GET /api/nope" },
	});
	await expect(page.getByRole("heading", { level: 1 })).toHaveCount(0);
});
