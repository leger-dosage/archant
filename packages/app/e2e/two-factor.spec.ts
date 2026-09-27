import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures.ts";
import { ADMIN, NEW_PASSWORD } from "./settings.ts";
import { totp } from "./totp.ts";

// Story 13.4: two-factor sign-in. Its own Playwright project, after the
// password change: every test signs in with the password that change set.
// The tests share one user's state and run in order: the first turns
// two-factor on, the last turns it off. Each test has its own client
// address, so each gets its own three sign-ins per ten seconds.
test.describe.configure({ mode: "serial" });

/** Read from the page by the first test, as a user would copy it into an app. */
let secret = "";
let backupCodes: string[] = [];

/** A code the server refuses: the right one, its last digit changed. */
function wrong(code: string): string {
	return `${code.slice(0, 5)}${(Number(code.at(5)) + 1) % 10}`;
}

async function passwordStep(page: Page, path: string) {
	await page.goto(path);
	await page.getByLabel("Adresse e-mail").fill(ADMIN.email);
	await page.getByLabel("Mot de passe").fill(NEW_PASSWORD);
	await page.getByRole("button", { name: "Se connecter" }).click();
}

async function codeStep(page: Page, code: string) {
	await page.getByLabel("Code de vérification").fill(code);
	await page.getByRole("button", { name: "Vérifier" }).click();
}

const section = (page: Page) => page.getByRole("region", { name: "Double authentification" });

test("turning it on asks for the password, then a code, and shows the backup codes once", async ({
	page,
}) => {
	await passwordStep(page, "/settings/security");
	const twoFactor = section(page);
	await expect(twoFactor.getByText(/^Désactivée\./u)).toBeVisible();

	await twoFactor.getByLabel("Mot de passe").fill("pas le bon mot de passe");
	await twoFactor.getByRole("button", { name: "Activer la double authentification" }).click();
	await expect(twoFactor.getByText("Mot de passe actuel incorrect.")).toBeVisible();

	await twoFactor.getByLabel("Mot de passe").fill(NEW_PASSWORD);
	await twoFactor.getByRole("button", { name: "Activer la double authentification" }).click();

	await expect(
		twoFactor.getByRole("img", { name: "QR code de la double authentification" }),
	).toBeVisible();
	secret = (
		await twoFactor.getByLabel("Clé à saisir si vous ne pouvez pas scanner").innerText()
	).trim();
	expect(secret).toMatch(/^[A-Z2-7]+$/u);

	await twoFactor.getByLabel("Code de vérification").fill(wrong(totp(secret)));
	await twoFactor.getByRole("button", { name: "Confirmer l'activation" }).click();
	await expect(twoFactor.getByText(/^Code incorrect\./u)).toBeVisible();

	await twoFactor.getByLabel("Code de vérification").fill(totp(secret));
	await twoFactor.getByRole("button", { name: "Confirmer l'activation" }).click();

	await expect(page.getByText("Double authentification activée.")).toBeVisible();
	const codes = twoFactor.getByRole("list", { name: "Codes de secours" }).getByRole("listitem");
	await expect(codes).toHaveCount(10);
	backupCodes = await codes.allInnerTexts();
	expect(backupCodes.every((code) => /^[\dA-Za-z]{5}-[\dA-Za-z]{5}$/u.test(code))).toBe(true);

	await twoFactor.getByRole("button", { name: "J'ai conservé ces codes" }).click();
	await expect(twoFactor.getByText(/^Activée\./u)).toBeVisible();

	// Once: a reload shows the state, never the codes.
	await page.reload();
	await expect(section(page).getByText(/^Activée\./u)).toBeVisible();
	await expect(page.getByText(backupCodes[0] ?? "")).toHaveCount(0);
});

test("sign-in asks for a code: a TOTP code, then a backup code, which is refused the second time", async ({
	page,
	context,
}) => {
	await passwordStep(page, "/accounts");
	// The second step, and no session yet.
	await expect(page.getByLabel("Code de vérification")).toBeVisible();
	await expect(page).toHaveURL(/\/sign-in/u);

	await codeStep(page, totp(secret));
	await expect(page.getByRole("heading", { level: 1, name: "Comptes" })).toBeVisible();

	await context.clearCookies();
	const [code = ""] = backupCodes;
	await passwordStep(page, "/accounts");
	await codeStep(page, code);
	await expect(page.getByRole("heading", { level: 1, name: "Comptes" })).toBeVisible();

	await context.clearCookies();
	await passwordStep(page, "/accounts");
	await codeStep(page, code);
	await expect(page.getByText(/^Code incorrect\./u)).toBeVisible();
	await expect(page).toHaveURL(/\/sign-in/u);
});

test("an expired challenge goes back to the password step and says to sign in again", async ({
	page,
	context,
}) => {
	await passwordStep(page, "/accounts");
	await expect(page.getByLabel("Code de vérification")).toBeVisible();

	// What ten minutes do: the browser drops the challenge's cookie.
	await context.clearCookies({ name: /two_factor/u });
	await codeStep(page, totp(secret));

	await expect(page.getByRole("alert")).toHaveText(
		"La vérification a expiré ou a échoué trop de fois. Connectez-vous de nouveau.",
	);
	await expect(page.getByLabel("Mot de passe")).toBeVisible();
	await expect(page.getByLabel("Code de vérification")).toHaveCount(0);
});

test("the code step says « trop de tentatives » on a 429, and a spent challenge goes back to the password step", async ({
	page,
}) => {
	await passwordStep(page, "/accounts");
	await expect(page.getByLabel("Code de vérification")).toBeVisible();

	// Answered here, never by the server: real wrong codes would count toward
	// the account lockout the last test still needs clear.
	const answers = [
		{ status: 429, json: { message: "Too many requests. Please try again later." } },
		{
			status: 400,
			json: {
				code: "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE",
				message: "Too many attempts. Please request a new code.",
			},
		},
	];
	await page.route("**/api/auth/two-factor/verify-totp", async (route) => {
		const answer = answers.shift();

		await (answer === undefined ? route.abort() : route.fulfill(answer));
	});

	await codeStep(page, totp(secret));
	await expect(page.getByRole("alert")).toHaveText(
		"Trop de tentatives. Réessayez un peu plus tard.",
	);
	await expect(page.getByLabel("Code de vérification")).toBeVisible();

	await codeStep(page, totp(secret));
	await expect(page.getByRole("alert")).toHaveText(
		"La vérification a expiré ou a échoué trop de fois. Connectez-vous de nouveau.",
	);
	await expect(page.getByLabel("Mot de passe")).toBeVisible();
	await expect(page.getByLabel("Code de vérification")).toHaveCount(0);
});

test("regenerating and turning off ask for the password; then sign-in has one step", async ({
	page,
	context,
}) => {
	await passwordStep(page, "/settings/security");
	await codeStep(page, totp(secret));
	const twoFactor = section(page);
	await expect(twoFactor.getByText(/^Activée\./u)).toBeVisible();

	await twoFactor.getByLabel("Mot de passe").fill("pas le bon mot de passe");
	await twoFactor.getByRole("button", { name: "Régénérer les codes de secours" }).click();
	await expect(twoFactor.getByText("Mot de passe actuel incorrect.")).toBeVisible();

	await twoFactor.getByLabel("Mot de passe").fill(NEW_PASSWORD);
	await twoFactor.getByRole("button", { name: "Régénérer les codes de secours" }).click();
	const codes = twoFactor.getByRole("list", { name: "Codes de secours" }).getByRole("listitem");
	await expect(codes).toHaveCount(10);
	const fresh = await codes.allInnerTexts();
	expect(fresh.filter((code) => backupCodes.includes(code))).toEqual([]);
	await twoFactor.getByRole("button", { name: "J'ai conservé ces codes" }).click();

	await twoFactor.getByLabel("Mot de passe").fill("pas le bon mot de passe");
	await twoFactor.getByRole("button", { name: "Désactiver la double authentification" }).click();
	await expect(twoFactor.getByText("Mot de passe actuel incorrect.")).toBeVisible();
	await expect(twoFactor.getByText(/^Activée\./u)).toBeVisible();

	await twoFactor.getByLabel("Mot de passe").fill(NEW_PASSWORD);
	await twoFactor.getByRole("button", { name: "Désactiver la double authentification" }).click();
	await expect(page.getByText("Double authentification désactivée.")).toBeVisible();
	await expect(twoFactor.getByText(/^Désactivée\./u)).toBeVisible();

	await context.clearCookies();
	await passwordStep(page, "/accounts");
	await expect(page.getByRole("heading", { level: 1, name: "Comptes" })).toBeVisible();
});
