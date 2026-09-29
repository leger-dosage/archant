import { readFile } from "node:fs/promises";

import { expect, test } from "./fixtures.ts";
import {
	ADMIN,
	ADMIN_FIRST_NAME,
	ADMIN_STATE,
	BANK_APPLICATION_ID,
	BANK_KEY_FILE,
	FOREIGN_WEB_URL,
	SETUP_TOKEN_FILE,
	WEB_URL,
} from "./settings.ts";

// Story 3.1: the first launch. The only moment the database has no user, so
// the setup project is where it is tested, and where the session every other
// test starts from is saved.

// Story 13.10: before the real setup, which it must not spend. The owner
// reads where the token is, then submits from an address `ARCHANT_URL` does
// not name: refused before any administrator exists, with what to change.
test("setup names where the token is, and refuses another address", async ({ page }) => {
	await page.goto(`${FOREIGN_WEB_URL}/setup`);

	const token = page.getByLabel("Jeton de configuration");
	await expect(token).toHaveAccessibleDescription(/docker compose logs archant/u);

	await token.fill(await readFile(SETUP_TOKEN_FILE, "utf8"));
	await page.getByLabel("Adresse e-mail").fill(ADMIN.email);
	await page.getByLabel("Mot de passe", { exact: true }).fill(ADMIN.password);
	await page.getByLabel("Confirmer le mot de passe").fill(ADMIN.password);
	await page.getByRole("button", { name: "Créer le compte" }).click();

	await expect(page.getByRole("alert")).toHaveText(
		"Archant est configuré pour une autre adresse. Donnez à ARCHANT_URL l'adresse affichée dans la barre d'adresse, puis redémarrez Archant.",
	);
	await expect(page).toHaveURL(`${FOREIGN_WEB_URL}/setup`);
});

test("a first launch leads to setup, and creating the administrator signs in", async ({ page }) => {
	await page.goto("/accounts");

	await expect(page).toHaveURL(/\/setup$/u);
	await expect(page.getByText("Créer le compte administrateur")).toBeVisible();
	// No shell before a user exists.
	await expect(page.getByRole("link", { name: "Opérations" })).toHaveCount(0);

	// Story 12.2: the optional first name, refused past 60 characters.
	await page.getByLabel("Prénom").fill("x".repeat(61));
	await page.getByLabel("Adresse e-mail").fill(ADMIN.email);
	await page.getByLabel("Mot de passe", { exact: true }).fill(ADMIN.password);
	await page.getByLabel("Confirmer le mot de passe").fill("pas le même");
	await page.getByRole("button", { name: "Créer le compte" }).click();

	await expect(page.getByText("Les mots de passe ne correspondent pas.")).toBeVisible();
	await expect(page.getByText("Ce texte est trop long.")).toBeVisible();
	// Story 13.1: the token is required before anything is sent.
	const token = page.getByLabel("Jeton de configuration");
	await expect(token).toHaveAccessibleDescription(/Ce champ est obligatoire\./u);

	await page.getByLabel("Prénom").fill(` ${ADMIN_FIRST_NAME} `);
	await page.getByLabel("Confirmer le mot de passe").fill(ADMIN.password);
	// A wrong token is refused under its field, and creates nothing.
	await token.fill("not-the-setup-token");
	await page.getByRole("button", { name: "Créer le compte" }).click();

	await expect(token).toHaveAccessibleDescription(/Ce jeton de configuration est incorrect\./u);
	await expect(page).toHaveURL(/\/setup$/u);

	// The token the run's server printed at start, as an owner reads it in the logs.
	await token.fill(await readFile(SETUP_TOKEN_FILE, "utf8"));
	await page.getByRole("button", { name: "Créer le compte" }).click();

	await expect(page).toHaveURL(`${WEB_URL}/`);
	await expect(page.getByRole("heading", { level: 1, name: "Tableau de bord" })).toBeVisible();
	await expect(page.getByText(`Bonjour ${ADMIN_FIRST_NAME}`, { exact: true })).toBeVisible();

	await page.context().storageState({ path: ADMIN_STATE });

	// Story 11.14: the server has no Enable Banking variable, so every bank
	// test runs on the credentials saved here, as a household saves them.
	const saved = await page.request.put("/api/bank-connections/credentials", {
		data: {
			applicationId: BANK_APPLICATION_ID,
			privateKey: await readFile(BANK_KEY_FILE, "utf8"),
		},
	});
	expect(saved.status()).toBe(200);
});
