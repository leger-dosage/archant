import type { Page, Response } from "@playwright/test";

import { expect, test } from "./fixtures.ts";

// Story 3.3: the API serves the built interface on its own port, as the
// container does.

test("reloading a deep link shows the page", async ({ page }) => {
	await page.goto("/accounts");
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

test("the page carries the Content-Security-Policy, and the theme script still runs under it", async ({
	page,
}) => {
	await page.addInitScript(() => {
		localStorage.setItem("archant.theme", "dark");
	});
	// Without the bundle, React never mounts: only the inline theme script can
	// set the class, and it runs only if the policy's hash admits it.
	await page.route("**/assets/*.js", (route) => route.abort());

	const response = await page.goto("/accounts");

	expect(response?.headers()["content-security-policy"]?.split("; ")).toEqual([
		"default-src 'self'",
		"script-src 'self' 'sha256-rAeCpAn2Kteerk13PeCDOI8kvlaCDjXxkwzZgMe0DQU='",
		"style-src 'self' 'unsafe-inline'",
		// The fake Enable Banking's origin, on a port chosen at each run.
		expect.stringMatching(
			/^img-src 'self' data: https:\/\/enablebanking\.com http:\/\/localhost:\d+$/u,
		),
		"connect-src 'self'",
		"object-src 'none'",
		"base-uri 'none'",
		"form-action 'self'",
		"frame-src 'none'",
		"frame-ancestors 'none'",
	]);
	await expect(page.locator("html")).toHaveClass(/\bdark\b/u);
});

// Story 15.5: the heavy parts of the interface load with the page that uses
// them. The date picker's classes start with `rdp-`; recharts wraps every
// chart in `recharts-wrapper`.

/** The text of every script `page` downloads from now on. */
function scriptsOf(page: Page): () => Promise<string[]> {
	const responses: Response[] = [];
	page.on("response", (response) => {
		if (response.request().resourceType() === "script") {
			responses.push(response);
		}
	});

	return async () => Promise.all(responses.map(async (response) => response.text()));
}

test("the dashboard draws its charts without the date picker, which comes with the account dialog", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingDate: "2024-01-01" });
	await api.addTransaction(account.id, { date: "2024-05-06", label: "Courses", amount: "-40,00" });
	const scripts = scriptsOf(page);

	await page.goto("/?month=2024-05");

	await expect(
		page.getByRole("region", { name: "Patrimoine net" }).locator(".recharts-area"),
	).toBeVisible();
	// The database is shared: other tests' rows of that month may add segments.
	await expect(
		page
			.getByRole("img", { name: /^Répartition des /u })
			.locator(".recharts-pie-sector")
			.first(),
	).toBeVisible();
	expect((await scripts()).filter((script) => script.includes("rdp-"))).toEqual([]);

	await page.getByRole("button", { name: "Ajouter un compte" }).first().click();

	const dialog = page.getByRole("dialog", { name: "Ajouter un compte" });
	await expect(dialog).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
});

test("a settings page loads no chart library", async ({ page }) => {
	const scripts = scriptsOf(page);

	await page.goto("/settings/security");

	await expect(page.getByLabel("Prénom")).toBeVisible();
	expect((await scripts()).filter((script) => script.includes("recharts-wrapper"))).toEqual([]);
});
