import type { Page } from "@playwright/test";

import { randomUUID } from "node:crypto";
import { z } from "zod";

import { createDb } from "@archant/data/client";

import { expect, test } from "./fixtures.ts";
import { ADMIN, DATABASE_FILE, WEB_URL } from "./settings.ts";

// Story 20.2: the administrator invites someone with a link shown once; the
// person opens it signed out, sets a password and lands signed in.

const INVALID = "Cette invitation n'est plus valable.";

const uniqueEmail = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}@archant.test`;

/** Whom the link's page names: the administrator's first name, else their email. */
async function inviterName(page: Page): Promise<string> {
	const response = await page.request.get("/api/auth/get-session");
	const { user } = z
		.object({ user: z.object({ name: z.string(), email: z.string() }) })
		.parse(await response.json());

	return user.name.trim() === "" ? user.email : user.name;
}

async function expectInvalid(page: Page, url: string) {
	await page.goto(url);
	await expect(
		page.getByRole("heading", { level: 1, name: "Invitation non valable" }),
	).toBeVisible();
	await expect(page.getByRole("alert")).toHaveText(INVALID);
	await expect(page.getByRole("link", { name: "Se connecter" })).toBeVisible();
}

test("an invited person opens the link signed out, sets a password and lands signed in, once", async ({
	page,
}) => {
	const email = uniqueEmail("dominique");
	const inviter = await inviterName(page);

	await page.goto("/settings/members");
	await expect(page.getByRole("heading", { level: 1, name: "Membres" })).toBeVisible();
	await page.getByRole("button", { name: "Inviter", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Inviter une personne" });
	await dialog.getByLabel("Adresse e-mail").fill(email);
	await expect(dialog.getByRole("combobox", { name: "Rôle" })).toHaveText("Lecteur");
	await dialog.getByRole("button", { name: "Créer le lien" }).click();

	const shown = page.getByRole("dialog", { name: `Lien d'invitation pour ${email}` });
	await expect(shown.getByText("Ce lien ne sera plus affiché.", { exact: false })).toBeVisible();
	await expect(shown.getByRole("button", { name: "Copier le lien d'invitation" })).toBeVisible();
	const link = (await shown.locator("code").textContent()) ?? "";
	expect(link).toMatch(new RegExp(`^${WEB_URL}/invitations/[\\w-]{43}$`, "u"));
	// Only « Terminé » closes it: the link is never shown again.
	await page.keyboard.press("Escape");
	await expect(shown).toBeVisible();
	await shown.getByRole("button", { name: "Terminé" }).click();

	const pending = page.getByRole("list", { name: "Invitations en attente" });
	await expect(pending.getByRole("listitem").filter({ hasText: email })).toContainText(
		"Lecteur · Expire le",
	);

	// Signed out, as the person the link is sent to.
	await page.context().clearCookies();
	await page.goto(link);

	await expect(page.getByRole("heading", { level: 1, name: "Rejoindre Archant" })).toBeVisible();
	await expect(
		page.getByText(`${inviter} vous invite à rejoindre Archant en tant que lecteur.`),
	).toBeVisible();
	const emailField = page.getByLabel("Adresse e-mail");
	await expect(emailField).toHaveValue(email);
	await expect(emailField).not.toBeEditable();
	await page.getByLabel("Prénom").fill("Dominique");
	await page.getByLabel("Mot de passe", { exact: true }).fill("mot de passe de Dominique");
	await page.getByLabel("Confirmer le mot de passe").fill("mot de passe de Dominique");
	await page.getByRole("button", { name: "Créer mon compte" }).click();

	await expect(page).toHaveURL(`${WEB_URL}/`);
	await expect(page.getByRole("heading", { level: 1, name: "Bonjour Dominique" })).toBeVisible();

	await page.context().clearCookies();
	await expectInvalid(page, link);
});

test("a revoked link and an unknown one say the invitation is no longer valid", async ({
	page,
	api,
}) => {
	const email = uniqueEmail("revoked");
	const { url } = await api.invite(email, "admin");

	await page.goto("/settings/members");
	const row = page
		.getByRole("list", { name: "Invitations en attente" })
		.getByRole("listitem")
		.filter({ hasText: email });
	await expect(row).toContainText("Administrateur · Expire le");
	await row.getByRole("button", { name: `Révoquer l'invitation de ${email}` }).click();
	const confirm = page.getByRole("alertdialog", { name: `Révoquer l'invitation de ${email} ?` });
	await confirm.getByRole("button", { name: "Révoquer" }).click();
	await expect(page.getByText(`Invitation de ${email} révoquée.`)).toBeVisible();
	await expect(row).toHaveCount(0);

	await page.context().clearCookies();
	await expectInvalid(page, url);
	await expectInvalid(page, "/invitations/not-a-token");
});

test("inviting an email that has an account says so under the field", async ({ page }) => {
	await page.goto("/settings/members");
	await page.getByRole("button", { name: "Inviter", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Inviter une personne" });
	const field = dialog.getByLabel("Adresse e-mail");
	await field.fill(ADMIN.email);
	await dialog.getByRole("button", { name: "Créer le lien" }).click();

	await expect(field).toHaveAccessibleDescription("Un compte existe déjà avec cette adresse.");
	await expect(dialog.getByRole("button", { name: "Créer le lien" })).toBeVisible();
});

test("a signed-in browser opening a link is asked to sign out first, with no form", async ({
	page,
	api,
}) => {
	const { url } = await api.invite(uniqueEmail("signed-in"));
	const { email } = z
		.object({ user: z.object({ email: z.string() }) })
		.parse(await (await page.request.get("/api/auth/get-session")).json()).user;

	await page.goto(url);

	await expect(page.getByRole("alert")).toHaveText(
		`Vous êtes connecté en tant que ${email}. Déconnectez-vous pour accepter cette invitation.`,
	);
	// Not pressed: it would end the administrator session every later test uses.
	await expect(page.getByRole("button", { name: "Se déconnecter" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Créer mon compte" })).toHaveCount(0);
});

test("a link revoked while its page is open says so once submitted", async ({
	page,
	api,
	request,
}) => {
	const { id, url } = await api.invite(uniqueEmail("open"));
	await page.context().clearCookies();
	await page.goto(url);
	await page.getByLabel("Mot de passe", { exact: true }).fill("un mot de passe assez long");
	await page.getByLabel("Confirmer le mot de passe").fill("un mot de passe assez long");

	const revoked = await request.delete(`/api/invitations/${id}`, { headers: { origin: WEB_URL } });
	expect(revoked.status()).toBe(200);
	await page.getByRole("button", { name: "Créer mon compte" }).click();

	await expect(
		page.getByRole("heading", { level: 1, name: "Invitation non valable" }),
	).toBeVisible();
	await expect(page.getByRole("alert")).toHaveText(INVALID);
});

test("an expired link says the invitation is no longer valid", async ({ page, api }) => {
	const { id, url } = await api.invite(uniqueEmail("expired"));
	const db = await createDb(`file:${DATABASE_FILE}`);

	try {
		await db.$client.execute({
			sql: "update invitations set expires_at = ? where id = ?",
			args: [Date.now() - 1000, id],
		});
	} finally {
		db.$client.close();
	}

	await page.context().clearCookies();
	await expectInvalid(page, url);
});
