import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";

import { apiHelpers, expect, test } from "./fixtures.ts";
import { ADMIN_STATE, WEB_URL } from "./settings.ts";

// Story 20.1: only an administrator connects an assistant. The viewer comes
// through an invitation, accepted beside the page, which then starts signed
// out, as a browser an assistant opens.
test.use({ storageState: { cookies: [], origins: [] } });

const PASSWORD = "mot de passe du lecteur";

const REDIRECT_URI = "http://127.0.0.1:33418/callback";

function authorizeUrl(clientId: string): string {
	const query = new URLSearchParams({
		response_type: "code",
		client_id: clientId,
		redirect_uri: REDIRECT_URI,
		scope: "archant:read archant:write offline_access",
		state: "e2e",
		code_challenge: createHash("sha256")
			.update(randomBytes(32).toString("base64url"))
			.digest("base64url"),
		code_challenge_method: "S256",
		resource: `${WEB_URL}/api/mcp`,
	});

	return `/api/auth/oauth2/authorize?${query.toString()}`;
}

test("the consent page tells a viewer only an administrator connects an assistant, and offers no answer", async ({
	page,
	playwright,
}) => {
	const email = `lecteur-${randomUUID().slice(0, 8)}@archant.test`;
	const administrator = await playwright.request.newContext({
		baseURL: WEB_URL,
		storageState: ADMIN_STATE,
	});
	const { url } = await apiHelpers(administrator).invite(email);
	await administrator.dispose();
	const accepted = await page.request.post("/api/invitations/accept", {
		data: { token: url.split("/").at(-1), password: PASSWORD },
	});
	expect(accepted.status()).toBe(201);
	// The acceptance signed the viewer in; the assistant's browser starts signed out.
	await page.context().clearCookies();
	const registered = await page.request.post("/api/auth/oauth2/register", {
		data: {
			client_name: "Agent du lecteur",
			redirect_uris: [REDIRECT_URI],
			application_type: "native",
			token_endpoint_auth_method: "none",
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
		},
	});
	expect(registered.status()).toBe(201);
	const { client_id: clientId } = z
		.object({ client_id: z.string() })
		.parse(await registered.json());

	await page.goto(authorizeUrl(clientId));
	await expect(page).toHaveURL(/\/sign-in\?/u);
	await page.getByLabel("Adresse e-mail").fill(email);
	await page.getByLabel("Mot de passe").fill(PASSWORD);
	await page.getByRole("button", { name: "Se connecter" }).click();

	await expect(page).toHaveURL(/\/oauth\/consent\?/u);
	await expect(
		page.getByRole("heading", { level: 1, name: "Autoriser un assistant" }),
	).toBeVisible();
	await expect(page.getByRole("alert")).toHaveText(
		"Seul un administrateur peut connecter un assistant.",
	);
	await expect(page.getByRole("button", { name: "Autoriser" })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Refuser" })).toHaveCount(0);
});
