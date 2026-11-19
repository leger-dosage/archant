import { randomUUID } from "node:crypto";
import { z } from "zod";

import { acceptInvitation, expect, test } from "./fixtures.ts";
import { WEB_URL } from "./settings.ts";

const INTRO = "Expérience d'introduction à venir";
const GUEST_ONLY = "L'intro n'est disponible que pour les utilisateurs invités.";

test("a guest signs in to Intro and regains the dashboard after promotion", async ({
	api,
	page,
	playwright,
	request,
}) => {
	const email = `intro-${randomUUID()}@archant.test`;
	const name = "Sacha";
	const password = "mot de passe du lecteur";
	const { url } = await api.invite(email);
	const guest = await playwright.request.newContext({ baseURL: WEB_URL });
	try {
		await acceptInvitation(guest, url, { name, password });
	} finally {
		await guest.dispose();
	}
	await page.context().clearCookies();
	await page.goto("/sign-in");
	await page.getByLabel("Adresse e-mail").fill(email);
	await page.getByLabel("Mot de passe").fill(password);
	await page.getByRole("button", { name: "Se connecter", exact: true }).click();
	await expect(page).toHaveURL(`${WEB_URL}/intro`);
	await expect(page.getByRole("heading", { level: 1, name: "Bienvenue !" })).toBeVisible();
	await expect(page.getByRole("heading", { level: 2, name: INTRO })).toBeVisible();
	const nav = page.getByRole("navigation", { name: "Navigation principale" });
	await expect(nav.getByRole("link")).toHaveText(["Accueil", "Intro"]);
	await expect(nav.getByRole("link", { name: "Intro" })).toHaveAttribute("aria-current", "page");
	await expect(page.getByRole("complementary", { name: "Liste des comptes" })).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Replier ou déplier la liste des comptes" }),
	).toHaveCount(0);

	await page.setViewportSize({ width: 390, height: 844 });
	await expect(nav.getByRole("link")).toHaveText(["Accueil", "Intro"]);
	await expect(page.getByRole("button", { name: "Ouvrir le menu" })).toHaveCount(0);
	await nav.getByRole("link", { name: "Accueil" }).click();
	await expect(page).toHaveURL(`${WEB_URL}/intro`);
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.getByRole("button", { name: email }).click();
	await page.getByRole("menuitem", { name: "Réglages" }).click();
	await expect(page).toHaveURL(`${WEB_URL}/settings/security`);
	await nav.getByRole("link", { name: "Intro" }).click();
	await expect(page).toHaveURL(`${WEB_URL}/intro`);

	const response = await request.get("/api/members");
	expect(response.ok()).toBe(true);
	const { data: members } = z
		.object({ data: z.array(z.object({ id: z.string(), email: z.string() })) })
		.parse(await response.json());
	const id = members.find((member) => member.email === email)?.id;
	const promoted = await request.patch(`/api/members/${id ?? ""}`, { data: { role: "member" } });
	expect(promoted.ok(), await promoted.text()).toBe(true);

	await page.reload();
	await expect(page).toHaveURL(`${WEB_URL}/`);
	await expect(page.getByRole("heading", { level: 1, name: `Bonjour ${name}` })).toBeVisible();
	await expect(page.getByText(GUEST_ONLY)).toBeVisible();
	await expect(page.getByRole("complementary", { name: "Liste des comptes" })).toBeVisible();
	await expect(nav.getByRole("link", { name: "Opérations" })).toBeVisible();
	await expect(nav.getByRole("link", { name: "Intro" })).toHaveCount(0);
});

test("Intro redirects an administrator to the dashboard with an explanation", async ({ page }) => {
	await page.goto("/intro");
	await expect(page).toHaveURL(`${WEB_URL}/`);
	await expect(page.getByText(GUEST_ONLY)).toBeVisible();
});
