import { hashPassword } from "better-auth/crypto";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";

import { createDb } from "@archant/data/client";

import { expect, test } from "./fixtures.ts";
import { DATABASE_FILE, WEB_URL } from "./settings.ts";

// Story 20.1: only an administrator connects an assistant. Nobody can invite a
// viewer before Story 20.2, so the test writes one to the database, password
// hashed as Better Auth hashes it. Starts signed out, as a browser an
// assistant opens.
test.use({ storageState: { cookies: [], origins: [] } });

const PASSWORD = "mot de passe du lecteur";

const REDIRECT_URI = "http://127.0.0.1:33418/callback";

async function insertViewer(email: string): Promise<void> {
	const db = await createDb(`file:${DATABASE_FILE}`);
	const id = randomUUID();

	try {
		await db.$client.batch(
			[
				{
					sql: "insert into users (id, name, email, role) values (?, '', ?, 'viewer')",
					args: [id, email],
				},
				{
					sql: "insert into auth_accounts (id, account_id, provider_id, user_id, password, updated_at) values (?, ?, 'credential', ?, ?, ?)",
					args: [randomUUID(), id, id, await hashPassword(PASSWORD), Date.now()],
				},
			],
			"write",
		);
	} finally {
		db.$client.close();
	}
}

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
}) => {
	const email = `lecteur-${randomUUID().slice(0, 8)}@archant.test`;
	await insertViewer(email);
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
