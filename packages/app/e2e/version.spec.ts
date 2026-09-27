import { expect, test } from "./fixtures.ts";

// Story 13.5: « Réglages » names the running release, which start-api.ts sets
// to 1.2.3 as the image sets it from its tag.

test("« Réglages » shows the running version, linked to its release notes", async ({ page }) => {
	await page.goto("/settings/categories");

	const version = page.getByRole("link", { name: "Version 1.2.3" });
	await expect(version).toBeVisible();
	await expect(version).toHaveAttribute(
		"href",
		"https://github.com/leger-dosage/archant/releases/tag/v1.2.3",
	);
	await expect(version).toHaveAttribute("target", "_blank");
	await expect(version).toHaveAttribute("rel", "noreferrer");
});

test("« Réglages » says a development build runs, without a link", async ({ page }) => {
	await page.route("**/api/version", (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({ data: { version: null } }),
		}),
	);

	await page.goto("/settings/categories");

	await expect(page.getByText("Version de développement")).toBeVisible();
	await expect(page.getByRole("link", { name: /^Version/u })).toHaveCount(0);
});

test("« Réglages » works without the version when its route fails", async ({ page }) => {
	let calls = 0;
	await page.route("**/api/version", (route) => {
		calls += 1;

		return route.fulfill({
			status: 500,
			contentType: "application/json",
			body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "Something went wrong." } }),
		});
	});

	await page.goto("/settings/categories");

	await expect(page.getByRole("heading", { name: "Catégories" })).toBeVisible();
	await expect(page.getByRole("link", { name: "Sécurité" })).toBeVisible();
	// No retry: the one failure is final, and only then would a toast show.
	await expect.poll(() => calls).toBe(1);
	// Counted once, not awaited with `toHaveCount(0)`: that retries until the
	// toast has timed out and gone, and would pass with one shown.
	await page.waitForTimeout(1000);
	expect(await page.getByText(/^Version/u).count()).toBe(0);
	expect(await page.getByText("Une erreur inattendue", { exact: false }).count()).toBe(0);
	expect(calls).toBe(1);
});
