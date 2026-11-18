import { randomUUID } from "node:crypto";

import { acceptInvitation, expect, test } from "./fixtures.ts";
import { freshTotp } from "./totp.ts";

test.use({ trace: "off" });

test("adds a passkey with a fresh code, signs in, and revokes it when two-factor is disabled", async ({
	api,
	context,
	page,
}) => {
	const email = `passkey-${randomUUID()}@archant.test`;
	const password = "mot de passe de la clé de test";
	const { url } = await api.invite(email);
	await context.clearCookies();
	await acceptInvitation(context.request, url, { name: "Sacha", password });

	const devtools = await context.newCDPSession(page);
	await devtools.send("WebAuthn.enable");
	const { authenticatorId } = await devtools.send("WebAuthn.addVirtualAuthenticator", {
		options: {
			protocol: "ctap2",
			transport: "internal",
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true,
		},
	});

	await page.goto("/settings/security");
	const twoFactor = page.getByRole("region", { name: "Double authentification" });
	const keys = page.getByRole("region", { name: "Clés d’accès et clés de sécurité" });
	await expect(keys).toHaveCount(0);
	await twoFactor.getByLabel("Mot de passe").fill(password);
	await twoFactor.getByRole("button", { name: "Activer la double authentification" }).click();
	const secret = await twoFactor
		.getByLabel("Clé à saisir si vous ne pouvez pas scanner")
		.innerText();
	const activationCode = await freshTotp(secret);
	await twoFactor.getByLabel("Code de vérification").fill(activationCode);
	await twoFactor.getByRole("button", { name: "Confirmer l'activation" }).click();
	await twoFactor.getByRole("button", { name: "J'ai conservé ces codes" }).click();

	const addKey = keys.getByRole("button", { name: "Ajouter une clé" });
	const codeField = keys.getByLabel("Code de l’application d’authentification");
	await keys.getByLabel("Nom de la clé").fill("Clé virtuelle");
	await codeField.fill(activationCode);
	await addKey.click();
	await expect(keys.getByRole("alert")).toHaveText("Ce code a déjà servi. Saisissez le suivant.");
	const { credentials } = await devtools.send("WebAuthn.getCredentials", { authenticatorId });
	expect(credentials).toHaveLength(0);

	const code = await freshTotp(secret);
	await codeField.fill(`${code.slice(0, 5)}${(Number(code.at(5)) + 1) % 10}`);
	await addKey.click();
	await expect(keys.getByRole("alert")).toHaveText("Le code est incorrect.");

	await codeField.fill(code);
	await addKey.click();
	const key = keys.getByRole("listitem").filter({ hasText: "Clé virtuelle" });
	await expect(key).toContainText("Dernière utilisation : jamais");
	await expect(key).toContainText("Ajoutée le");

	await keys.getByLabel("Nom de la clé").fill("Autre clé");
	await codeField.fill(code);
	await addKey.click();
	await expect(keys.getByRole("alert")).toHaveText("Ce code a déjà servi. Saisissez le suivant.");

	const standalone = process.env["AUTH_PASSKEY_LOGIN_ENABLED"] !== "false";
	await context.clearCookies();
	await page.goto("/sign-in?redirect=/settings/security");
	const passkeyButton = page.getByRole("button", { name: "Se connecter avec une clé d’accès" });
	if (standalone) {
		await passkeyButton.click();
		await expect(key).toBeVisible();
		await expect(key).not.toContainText("Dernière utilisation : jamais");
		await context.clearCookies();
		await page.goto("/sign-in?redirect=/settings/security");
	} else {
		await expect(passkeyButton).toHaveCount(0);
	}

	await page.getByLabel("Adresse e-mail").fill(email);
	await page.getByLabel("Mot de passe").fill(password);
	await page.getByRole("button", { name: "Se connecter", exact: true }).click();
	await expect(page.getByLabel("Code de vérification")).toBeVisible();
	await page.getByRole("button", { name: "Utiliser une clé de sécurité" }).click();
	await expect(key).toBeVisible();
	await expect(key).not.toContainText("Dernière utilisation : jamais");

	await key.getByRole("button", { name: "Supprimer" }).click();
	await page.getByRole("alertdialog").getByRole("button", { name: "Annuler" }).click();
	await expect(key).toBeVisible();

	await twoFactor.getByLabel("Mot de passe").fill(password);
	await twoFactor.getByRole("button", { name: "Désactiver la double authentification" }).click();
	await expect(keys).toHaveCount(0);
	const list = await context.request.get("/api/auth/passkey/list-user-passkeys");
	expect(list.status()).toBe(200);
	expect(await list.json()).toEqual([]);
});
