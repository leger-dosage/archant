import type { APIRequest, Browser, Page } from "@playwright/test";

import { expect, test } from "./fixtures.ts";
import { ADMIN, NEW_PASSWORD, WEB_URL } from "./settings.ts";
import { freshTotp } from "./totp.ts";

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
	await twoFactor.getByLabel("Code de vérification").fill(await freshTotp(secret));
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

/**
 * Twenty strangers fail, each from an address of its own, as a guesser with
 * many addresses would; failures from earlier projects may already have filled
 * part of the window, so a refusal here is a full ceiling too. TEST-NET-1
 * addresses, which the `clientAddress` fixture never draws.
 */
async function fillCeiling(request: APIRequest) {
	const strangers = await request.newContext({
		baseURL: WEB_URL,
		extraHTTPHeaders: { origin: WEB_URL },
	});
	const statuses = await Promise.all(
		Array.from({ length: 20 }, async (_, index) => {
			const response = await strangers.post("/api/auth/sign-in/email", {
				headers: { "x-forwarded-for": `192.0.2.${index + 1}` },
				data: { email: ADMIN.email, password: "pas le bon mot de passe" },
			});

			return response.status();
		}),
	);
	await strangers.dispose();
	expect(statuses.every((status) => status === 401 || status === 429)).toBe(true);
}

/**
 * Whether a browser that never signed in, with the right password, is refused.
 * Let through, it meets the code step instead.
 */
async function newBrowserRefused(browser: Browser, round: number): Promise<boolean> {
	// Its own address: three sign-ins from one address in ten seconds would
	// meet Better Auth's own limit, which also answers 429.
	const fresh = await browser.newContext({
		baseURL: WEB_URL,
		locale: "fr-FR",
		extraHTTPHeaders: { "x-forwarded-for": `192.0.2.${100 + round}` },
	});
	const stranger = await fresh.newPage();
	await passwordStep(stranger);
	const refusal = stranger.getByRole("alert");
	const codeStepShown = stranger.getByLabel("Code de vérification");
	await expect(refusal.or(codeStepShown)).toBeVisible();
	const refused = await refusal.isVisible();

	if (refused) {
		await expect(refusal).toHaveText("Trop de tentatives. Réessayez un peu plus tard.");
		await expect(stranger).toHaveURL(/\/sign-in$/u);
	}

	await fresh.close();

	return refused;
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
	await codeStep(page, await freshTotp(secret));
	await expect(greeting(page)).toBeVisible();

	// A window runs ten minutes from the sign-in that opened it, which an
	// earlier project may have sent nine minutes ago, so it can end between the
	// strangers and the new browser. The next sign-in then opened a window
	// within this test, and a second round fills one that outlasts it.
	const round = async (index: number) => {
		await fillCeiling(playwright.request);
		await signOut(page);
		// An address per round: Better Auth allows one address three sign-ins
		// per ten seconds, and this browser has had two.
		await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `192.0.2.${200 + index}` });
		await passwordStep(page);
		await codeStep(page, await freshTotp(secret));
		await expect(greeting(page)).toBeVisible();

		return newBrowserRefused(browser, index);
	};
	const refused = (await round(1)) || (await round(2));

	expect(refused).toBe(true);
});
