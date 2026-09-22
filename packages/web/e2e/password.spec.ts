import { expect, test } from "./fixtures.ts";
import { ADMIN, WEB_URL } from "./settings.ts";

// Story 3.2: changing the password. Its own Playwright project, run after
// every other file: the change revokes every session of the single user, the
// saved administrator session included, so nothing may follow it.

const NEW_PASSWORD = "un autre mot de passe de test";

// First on purpose: it writes nothing and sends no request, so it costs the
// change below neither a rate-limit attempt nor a known password.
test("a new password too short, or a confirmation that differs, is refused without a request", async ({
	page,
}) => {
	await page.goto("/reglages/securite");
	// A request would mean the browser trusted the server with a password the
	// form could refuse on its own.
	const sent: string[] = [];
	await page.route("**/api/auth/change-password", async (route) => {
		sent.push(route.request().url());
		await route.abort();
	});

	await page.getByLabel("Mot de passe actuel").fill(ADMIN.password);
	await page.getByLabel("Nouveau mot de passe", { exact: true }).fill("1234567");
	await page.getByLabel("Confirmer le nouveau mot de passe").fill("1234567");
	await page.getByRole("button", { name: "Modifier le mot de passe" }).click();

	await expect(
		page.getByText("Le mot de passe doit contenir au moins 8 caractères."),
	).toBeVisible();

	await page.getByLabel("Nouveau mot de passe", { exact: true }).fill(NEW_PASSWORD);
	await page.getByLabel("Confirmer le nouveau mot de passe").fill("pas le même");
	await page.getByRole("button", { name: "Modifier le mot de passe" }).click();

	await expect(page.getByText("Les mots de passe ne correspondent pas.")).toBeVisible();

	expect(sent).toEqual([]);
});

test("changing the password keeps this session and refuses the old password", async ({
	page,
	playwright,
}) => {
	await page.goto("/reglages/securite");
	await expect(page.getByRole("heading", { level: 1, name: "Réglages" })).toBeVisible();

	await page.getByLabel("Mot de passe actuel").fill("pas le bon mot de passe");
	await page.getByLabel("Nouveau mot de passe", { exact: true }).fill(NEW_PASSWORD);
	await page.getByLabel("Confirmer le nouveau mot de passe").fill(NEW_PASSWORD);
	await page.getByRole("button", { name: "Modifier le mot de passe" }).click();

	await expect(page.getByText("Mot de passe actuel incorrect.")).toBeVisible();

	await page.getByLabel("Mot de passe actuel").fill(ADMIN.password);
	await page.getByRole("button", { name: "Modifier le mot de passe" }).click();

	await expect(page.getByText("Mot de passe modifié.")).toBeVisible();
	// The form is emptied, and this browser keeps its session.
	await expect(page.getByLabel("Mot de passe actuel")).toHaveValue("");
	await page.goto("/comptes");
	await expect(page.getByRole("heading", { level: 1, name: "Comptes" })).toBeVisible();

	// A fresh client, so this sign-in has a rate-limit bucket of its own.
	const stranger = await playwright.request.newContext({
		// Better Auth refuses a sign-in from an origin it does not trust.
		extraHTTPHeaders: { "x-forwarded-for": "10.99.99.99", origin: WEB_URL },
	});
	const refused = await stranger.post("/api/auth/sign-in/email", { data: ADMIN });
	const accepted = await stranger.post("/api/auth/sign-in/email", {
		data: { email: ADMIN.email, password: NEW_PASSWORD },
	});
	await stranger.dispose();

	expect(refused.status()).toBe(401);
	expect(accepted.status()).toBe(200);
});

// Last test of the last project: signing out ends the session every other
// test would have needed, so it can strand nothing.
test("the palette signs out", async ({ page }) => {
	// The saved session died with the password change above, so this test signs
	// in with the new one; nothing follows it to spend a session on.
	await page.goto("/comptes");
	await page.getByLabel("Adresse e-mail").fill(ADMIN.email);
	await page.getByLabel("Mot de passe").fill(NEW_PASSWORD);
	await page.getByRole("button", { name: "Se connecter" }).click();
	await expect(page.getByRole("heading", { level: 1, name: "Comptes" })).toBeVisible();

	await page.keyboard.press("ControlOrMeta+K");
	const palette = page.getByRole("dialog", { name: "Palette de commandes" });
	await palette.getByRole("combobox").fill("deconnecter");
	await expect(palette.getByRole("option", { name: "Se déconnecter" })).toBeVisible();
	await page.keyboard.press("Enter");

	await expect(page).toHaveURL(/\/connexion$/u);
});
