import { readFile } from "node:fs/promises";

import { acceptInvitation, apiHelpers, expect, test } from "./fixtures.ts";
import {
	ADMIN_STATE,
	PASSWORD_RESET_EMAIL,
	PASSWORD_RESET_LINK_FILE,
	WEB_URL,
} from "./settings.ts";

test.use({
	storageState: { cookies: [], origins: [] },
	trace: "off",
	screenshot: "off",
	video: "off",
});

test("a guest can sign in again through the link delivered by email", async ({
	page,
	playwright,
}) => {
	const admin = await playwright.request.newContext({
		baseURL: WEB_URL,
		storageState: ADMIN_STATE,
	});
	const oldSession = await playwright.request.newContext({ baseURL: WEB_URL });
	try {
		const { url } = await apiHelpers(admin).invite(PASSWORD_RESET_EMAIL);
		await acceptInvitation(oldSession, url, { password: "initial fixture password" });
		expect((await oldSession.get("/api/accounts")).status()).toBe(200);

		await page.goto("/sign-in");
		await page.getByRole("link", { name: "Mot de passe oublié ?" }).click();
		await expect(page.getByRole("heading", { name: "Mot de passe oublié ?" })).toBeVisible();
		const address = page.getByLabel("Adresse e-mail");
		await address.pressSequentially(PASSWORD_RESET_EMAIL);
		expect((await address.inputValue()) === PASSWORD_RESET_EMAIL).toBe(true);
		await page.getByRole("button", { name: "Envoyer le lien" }).click();
		await expect(
			page.getByText(
				"Veuillez vérifier votre boîte mail pour un lien de réinitialisation de votre mot de passe.",
			),
		).toBeVisible();

		let link = "";
		await expect
			.poll(async () => {
				link = await readFile(PASSWORD_RESET_LINK_FILE, "utf8").catch(() => "");
				return link.startsWith(`${WEB_URL}/reset-password#token=`);
			})
			.toBe(true);

		// A failed goto would print the whole address, including its fragment.
		await page.evaluate((href) => window.location.assign(href), link);
		await expect(
			page.getByRole("heading", { name: "Réinitialiser votre mot de passe" }),
		).toBeVisible();
		await expect.poll(() => new URL(page.url()).hash === "").toBe(true);

		const newPassword = "updated fixture password";
		await page.getByLabel("Nouveau mot de passe", { exact: true }).fill(newPassword);
		await page.getByLabel("Confirmer le nouveau mot de passe").fill(newPassword);
		await page.getByRole("button", { name: "Réinitialiser le mot de passe" }).click();
		await expect(page.getByText("Votre mot de passe a été réinitialisé.")).toBeVisible();
		expect((await oldSession.get("/api/accounts")).status()).toBe(401);

		await page.getByLabel("Adresse e-mail").fill(PASSWORD_RESET_EMAIL);
		await page.getByLabel("Mot de passe", { exact: true }).fill(newPassword);
		await page.getByRole("button", { name: "Se connecter", exact: true }).click();
		await expect(page.getByRole("heading", { name: "Bienvenue !", exact: true })).toBeVisible();

		await page.evaluate((href) => window.location.assign(href), link);
		await expect(page.getByText("Jeton invalide.")).toBeVisible();
	} finally {
		await oldSession.dispose();
		await admin.dispose();
	}
});
