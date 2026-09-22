import type { Page } from "@playwright/test";

import { apiHelpers, expect, test } from "./fixtures.ts";
import { ADMIN, ADMIN_STATE } from "./settings.ts";

// Story 3.1: sign-in. Every test here starts signed out; the administrator
// exists already, created by the setup project.
test.use({ storageState: { cookies: [], origins: [] } });

async function signIn(page: Page, password: string) {
	await page.getByLabel("Adresse e-mail").fill(ADMIN.email);
	await page.getByLabel("Mot de passe").fill(password);
	await page.getByRole("button", { name: "Se connecter" }).click();
}

test("once a user exists, setup leads to sign-in", async ({ page }) => {
	await page.goto("/setup");

	await expect(page).toHaveURL(/\/connexion$/u);
	await expect(page.getByText("Connexion", { exact: true })).toBeVisible();
});

test("the API refuses a call without a session", async ({ request }) => {
	const response = await request.get("/api/accounts");

	expect(response.status()).toBe(401);
	expect(await response.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
});

test("Better Auth refuses a sign-in from another origin", async ({ request }) => {
	const response = await request.post("/api/auth/sign-in/email", {
		headers: { origin: "https://attacker.example" },
		data: ADMIN,
	});

	expect(response.status()).toBe(403);
	expect(response.headers()["set-cookie"]).toBeUndefined();
});

test("a wrong password shows an error and stays on the page", async ({ page }) => {
	await page.goto("/connexion");

	await signIn(page, "pas le bon mot de passe");

	await expect(page.getByRole("alert")).toHaveText("Adresse e-mail ou mot de passe invalide.");
	await expect(page).toHaveURL(/\/connexion$/u);
});

test("signing in lands back on the page asked for", async ({ page, playwright }) => {
	// Created as the administrator: this test's own context has no session.
	const admin = await playwright.request.newContext({ storageState: ADMIN_STATE });
	const account = await apiHelpers(admin).openAccount();
	await admin.dispose();

	await page.goto(`/comptes/${account.id}?tab=imports`);

	await expect(page).toHaveURL(/\/connexion\?redirect=/u);

	await signIn(page, ADMIN.password);

	await expect(page).toHaveURL(new RegExp(`/comptes/${account.id}\\?tab=imports$`, "u"));
	await expect(page.getByRole("heading", { level: 1, name: account.name })).toBeVisible();
});

test.describe("a session lost mid-use", () => {
	test.use({ storageState: ADMIN_STATE });

	test("sends the next data request to sign-in, then back to its page", async ({
		page,
		context,
	}) => {
		await page.goto("/comptes");
		await expect(page.getByRole("heading", { level: 1, name: "Comptes" })).toBeVisible();

		// The interface still believes in its cached session; the API no longer does.
		await context.clearCookies();
		await page.getByRole("link", { name: "Opérations" }).click();

		await expect(page).toHaveURL(/\/connexion\?redirect=%2Foperations$/u);

		await signIn(page, ADMIN.password);

		await expect(page).toHaveURL(/\/operations$/u);
		await expect(page.getByRole("heading", { level: 1, name: "Opérations" })).toBeVisible();
	});
});
