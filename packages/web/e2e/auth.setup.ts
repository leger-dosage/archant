import { expect, test } from "./fixtures.ts";
import { ADMIN, ADMIN_STATE, WEB_URL } from "./settings.ts";

// Story 3.1: the first launch. The only moment the database has no user, so
// the setup project is where it is tested, and where the session every other
// test starts from is saved.

test("a first launch leads to setup, and creating the administrator signs in", async ({ page }) => {
	await page.goto("/accounts");

	await expect(page).toHaveURL(/\/setup$/u);
	await expect(page.getByText("Créer le compte administrateur")).toBeVisible();
	// No sidebar before a user exists.
	await expect(page.getByRole("link", { name: "Opérations" })).toHaveCount(0);

	await page.getByLabel("Adresse e-mail").fill(ADMIN.email);
	await page.getByLabel("Mot de passe", { exact: true }).fill(ADMIN.password);
	await page.getByLabel("Confirmer le mot de passe").fill("pas le même");
	await page.getByRole("button", { name: "Créer le compte" }).click();

	await expect(page.getByText("Les mots de passe ne correspondent pas.")).toBeVisible();

	await page.getByLabel("Confirmer le mot de passe").fill(ADMIN.password);
	await page.getByRole("button", { name: "Créer le compte" }).click();

	await expect(page).toHaveURL(`${WEB_URL}/`);
	await expect(page.getByRole("heading", { level: 1, name: "Tableau de bord" })).toBeVisible();

	await page.context().storageState({ path: ADMIN_STATE });
});
