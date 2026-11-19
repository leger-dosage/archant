import { z } from "zod";

import { OPENID_INVITEE } from "./fake-openid-connect.ts";
import { expect, test } from "./fixtures.ts";
import { WEB_URL } from "./settings.ts";

test("accepts a household invitation and signs in again with OpenID Connect", async ({
	api,
	page,
}) => {
	const invitation = await api.invite(OPENID_INVITEE, "member");
	const signIn = page.getByRole("button", { name: "Se connecter avec OpenID Connect" });
	await page.context().clearCookies();
	await page.goto(invitation.url);
	await signIn.click();
	await expect(page).toHaveURL(`${WEB_URL}/`);
	await expect(page.getByRole("heading", { name: "Bonjour Dominique", level: 1 })).toBeVisible();

	const response = await page.request.get("/api/auth/get-session");
	const session = z
		.object({ user: z.object({ email: z.string(), role: z.string() }) })
		.parse(await response.json());
	expect(session.user).toEqual({ email: OPENID_INVITEE, role: "member" });

	await page.context().clearCookies();
	await page.goto("/sign-in");
	await signIn.click();
	await expect(page).toHaveURL(`${WEB_URL}/`);
	await expect(page.getByRole("heading", { name: "Bonjour Dominique", level: 1 })).toBeVisible();
});
