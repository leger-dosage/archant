import { randomInt, randomUUID } from "node:crypto";
import { z } from "zod";

import { acceptInvitation, expect, test, uniqueName } from "./fixtures.ts";
import { ADMIN, WEB_URL } from "./settings.ts";

// Story 20.3: « Réglages › Membres » lists who has access. The administrator
// changes another member's role and removes them, never their own row.

const PAGE = "/settings/members";

test("the administrator sees themselves as « Vous », with no action", async ({ page }) => {
	await page.goto(PAGE);

	const members = page.getByRole("list", { name: "Membres" });
	const self = members.getByRole("listitem").filter({ hasText: ADMIN.email });
	await expect(self).toContainText("Administrateur");
	await expect(self).toContainText("Vous");
	await expect(self.getByRole("button")).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Inviter", exact: true })).toBeVisible();
	await expect(page.getByRole("region", { name: "Invitations en attente" })).toBeVisible();
});

test("a member is promoted, demoted, then removed, each after a confirmation, applied at their next request", async ({
	page,
	api,
	playwright,
}) => {
	const name = uniqueName("Sacha");
	const email = `membre-${randomUUID().slice(0, 8)}@archant.test`;
	const { url } = await api.invite(email);
	// The member's own browser, from an address of its own.
	const member = await playwright.request.newContext({
		baseURL: WEB_URL,
		extraHTTPHeaders: { "x-forwarded-for": `10.${randomInt(256)}.${randomInt(256)}.9` },
	});
	await acceptInvitation(member, url, { name, password: "mot de passe du membre" });
	// The members list is an administrator's read.
	expect((await member.get("/api/members")).status()).toBe(403);

	const invitee = `invite-${randomUUID().slice(0, 8)}@archant.test`;

	await page.goto(PAGE);
	const pending = page.getByRole("region", { name: "Invitations en attente" });
	const row = page
		.getByRole("list", { name: "Membres" })
		.getByRole("listitem")
		.filter({ hasText: email });
	await expect(row).toContainText(name);
	await expect(row).toContainText("Lecteur");

	await test.step("promoted", async () => {
		await row.getByRole("button", { name: `Actions pour ${name}` }).click();
		await page.getByRole("menuitem", { name: "Passer administrateur" }).click();
		const dialog = page.getByRole("alertdialog", { name: `Passer ${name} administrateur ?` });
		await dialog.getByRole("button", { name: "Passer administrateur" }).click();

		await expect(page.getByText(`${name} est maintenant administrateur.`)).toBeVisible();
		await expect(row).toContainText("Administrateur");
		expect((await member.get("/api/members")).status()).toBe(200);
		// An invitation of their own, which their demotion takes away.
		const sent = await member.post("/api/invitations", { data: { email: invitee, role: "admin" } });
		expect(sent.status(), await sent.text()).toBe(201);
		await page.reload();
		await expect(pending.getByText(invitee)).toBeVisible();
	});

	await test.step("demoted", async () => {
		await row.getByRole("button", { name: `Actions pour ${name}` }).click();
		await page.getByRole("menuitem", { name: "Passer lecteur" }).click();
		const dialog = page.getByRole("alertdialog", { name: `Passer ${name} lecteur ?` });
		await expect(dialog).toContainText(
			"Ses assistants connectés et ses invitations en attente seront supprimés.",
		);
		await dialog.getByRole("button", { name: "Passer lecteur" }).click();

		await expect(page.getByText(`${name} est maintenant lecteur.`)).toBeVisible();
		await expect(row).toContainText("Lecteur");
		await expect(pending.getByText(invitee)).toHaveCount(0);
		expect((await member.get("/api/members")).status()).toBe(403);
	});

	await test.step("removed", async () => {
		await row.getByRole("button", { name: `Actions pour ${name}` }).click();
		await page.getByRole("menuitem", { name: "Retirer" }).click();
		const dialog = page.getByRole("alertdialog", { name: `Retirer ${name} ?` });
		await expect(dialog).toContainText("ses sessions seront fermées sur tous ses appareils");
		await dialog.getByRole("button", { name: "Retirer" }).click();

		await expect(page.getByText(`${name} n'a plus accès à Archant.`)).toBeVisible();
		await expect(row).toHaveCount(0);
		// Signed out everywhere: their session is gone with them.
		expect((await member.get("/api/accounts")).status()).toBe(401);
	});

	await member.dispose();
});

test("an administrator demoted while their page is open leaves it at their next refused write", async ({
	api,
	browser,
	request,
}) => {
	const email = `second-${randomUUID().slice(0, 8)}@archant.test`;
	const { url } = await api.invite(email, "admin");
	// The second administrator's own browser, from an address of its own.
	const context = await browser.newContext({
		baseURL: WEB_URL,
		locale: "fr-FR",
		extraHTTPHeaders: { "x-forwarded-for": `10.${randomInt(256)}.${randomInt(256)}.10` },
	});
	const page = await context.newPage();

	try {
		await acceptInvitation(page.request, url, { password: "mot de passe du second" });
		await page.goto("/settings/tags");
		await expect(page.getByRole("heading", { level: 1, name: "Étiquettes" })).toBeVisible();

		const listed = await request.get("/api/members");
		const id = z
			.object({ data: z.array(z.object({ id: z.string(), email: z.string() })) })
			.parse(await listed.json())
			.data.find((member) => member.email === email)?.id;
		const demoted = await request.patch(`/api/members/${id ?? ""}`, { data: { role: "viewer" } });
		expect(demoted.status(), await demoted.text()).toBe(200);

		// The page still shows the administrator's controls until a request is refused.
		await page.getByRole("button", { name: "Ajouter une étiquette" }).first().click();
		await page.getByRole("dialog").getByLabel("Nom").fill(uniqueName("Refusée"));
		await page.getByRole("dialog").getByRole("button", { name: "Ajouter une étiquette" }).click();

		await expect(page).toHaveURL(`${WEB_URL}/settings/security`);
		await expect(
			page.getByRole("navigation", { name: "Réglages" }).getByRole("listitem"),
		).toHaveText(["Sécurité"]);
		await expect(page.getByRole("button", { name: "Ajouter un compte" })).toHaveCount(0);
	} finally {
		await context.close();
	}
});
