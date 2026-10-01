import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures.ts";
import { ADMIN, NEW_PASSWORD, WEB_URL } from "./settings.ts";
import { totp } from "./totp.ts";

// Story 15.4: a full sign-in ceiling lets a known device through. Its own
// Playwright project, the very last: the ceiling it fills refuses every other
// sign-in for ten minutes. It signs in with the password the `password`
// project set, and turns two-factor on again, which the `two-factor` project
// leaves off.
test.use({ storageState: { cookies: [], origins: [] } });

async function passwordStep(page: Page, password: string = NEW_PASSWORD) {
	await page.goto("/sign-in");
	await page.getByLabel("Adresse e-mail").fill(ADMIN.email);
	await page.getByLabel("Mot de passe").fill(password);
	await page.getByRole("button", { name: "Se connecter" }).click();
}

async function codeStep(page: Page, code: string) {
	await page.getByLabel("Code de vérification").fill(code);
	await page.getByRole("button", { name: "Vérifier" }).click();
}

const greeting = (page: Page) => page.getByRole("heading", { level: 1, name: /^Bonjour/u });

/** Turns two-factor on from « Réglages », as the user would, and returns its secret. */
async function turnTwoFactorOn(page: Page): Promise<string> {
	await page.goto("/settings/security");
	const twoFactor = page.getByRole("region", { name: "Double authentification" });
	await twoFactor.getByLabel("Mot de passe").fill(NEW_PASSWORD);
	await twoFactor.getByRole("button", { name: "Activer la double authentification" }).click();
	const secret = (
		await twoFactor.getByLabel("Clé à saisir si vous ne pouvez pas scanner").innerText()
	).trim();
	await twoFactor.getByLabel("Code de vérification").fill(totp(secret));
	await twoFactor.getByRole("button", { name: "Confirmer l'activation" }).click();
	await twoFactor.getByRole("button", { name: "J'ai conservé ces codes" }).click();
	await expect(twoFactor.getByText(/^Activée\./u)).toBeVisible();

	return secret;
}

async function signOut(page: Page) {
	await page.getByRole("button", { name: ADMIN.email }).click();
	await page.getByRole("menuitem", { name: "Se déconnecter" }).click();
	await expect(page).toHaveURL(/\/sign-in$/u);
}

test("a browser that signed in before passes a full ceiling, a new one is refused", async ({
	page,
	browser,
	playwright,
}) => {
	await passwordStep(page);
	await expect(greeting(page)).toBeVisible();
	const secret = await turnTwoFactorOn(page);
	await signOut(page);

	// The sign-in that earns this browser its device cookie: password and code.
	await passwordStep(page);
	await codeStep(page, totp(secret));
	await expect(greeting(page)).toBeVisible();

	// Twenty strangers fail, each from an address of its own, as a guesser
	// with many addresses would; failures from earlier projects may already
	// have filled part of the window, so a refusal here is a full ceiling too.
	const strangers = await playwright.request.newContext({
		baseURL: WEB_URL,
		extraHTTPHeaders: { origin: WEB_URL },
	});
	const statuses = await Promise.all(
		Array.from({ length: 20 }, async (_, index) => {
			const response = await strangers.post("/api/auth/sign-in/email", {
				headers: { "x-forwarded-for": `10.250.0.${index + 1}` },
				data: { email: ADMIN.email, password: "pas le bon mot de passe" },
			});

			return response.status();
		}),
	);
	await strangers.dispose();
	expect(statuses.every((status) => status === 401 || status === 429)).toBe(true);

	await signOut(page);
	await passwordStep(page);
	await codeStep(page, totp(secret));
	await expect(greeting(page)).toBeVisible();

	// Its own address too: three sign-ins from one address in ten seconds
	// would meet Better Auth's own limit, which also answers 429.
	const fresh = await browser.newContext({
		baseURL: WEB_URL,
		locale: "fr-FR",
		extraHTTPHeaders: { "x-forwarded-for": "10.251.0.1" },
	});
	const stranger = await fresh.newPage();
	await passwordStep(stranger);

	await expect(stranger.getByRole("alert")).toHaveText(
		"Trop de tentatives. Réessayez un peu plus tard.",
	);
	await expect(stranger).toHaveURL(/\/sign-in$/u);
	await fresh.close();
});
