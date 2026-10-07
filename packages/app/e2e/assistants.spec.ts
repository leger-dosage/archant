import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";

import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

import { expect, test } from "./fixtures.ts";
import { ADMIN, NEW_PASSWORD, WEB_URL } from "./settings.ts";
import { totp } from "./totp.ts";

// Story 16.1: an assistant is refused, then another connects and is
// disconnected. In the `two-factor` project, after the password change: the
// owner signs in with the password it set, then also with a code. The second
// test turns two-factor on, and off again even when it fails, so
// `two-factor.spec.ts` and `ceiling` start from it off.
test.describe.configure({ mode: "serial" });

/** Where the assistant listens for its code, as Claude Code does on loopback. */
const REDIRECT_URI = "http://127.0.0.1:33418/callback";

const MCP = `${WEB_URL}/api/mcp`;

const READ_TOOLS = [
	"get_accounts",
	"get_categories",
	"get_merchants",
	"get_tags",
	"get_transactions",
	"get_transaction",
	"group_transactions_by_label",
	"get_balance_sheet",
	"get_income_statement",
	"get_budget",
	"get_recurring_transactions",
	"get_bills",
	"get_bill_details",
	"get_bill_audit",
	"get_holdings",
	"get_rules",
	"get_rule_runs",
	"preview_rule",
];

const section = (page: Page) => page.getByRole("region", { name: "Double authentification" });

async function passwordStep(page: Page) {
	await page.getByLabel("Adresse e-mail").fill(ADMIN.email);
	await page.getByLabel("Mot de passe").fill(NEW_PASSWORD);
	await page.getByRole("button", { name: "Se connecter" }).click();
}

/** Turns two-factor on through the security page and returns the secret. */
async function turnTwoFactorOn(page: Page): Promise<string> {
	await page.goto("/settings/security");
	await passwordStep(page);
	const twoFactor = section(page);
	await twoFactor.getByLabel("Mot de passe").fill(NEW_PASSWORD);
	await twoFactor.getByRole("button", { name: "Activer la double authentification" }).click();
	const secret = (
		await twoFactor.getByLabel("Clé à saisir si vous ne pouvez pas scanner").innerText()
	).trim();
	await twoFactor.getByLabel("Code de vérification").fill(totp(secret));
	await twoFactor.getByRole("button", { name: "Confirmer l'activation" }).click();
	await twoFactor.getByRole("button", { name: "J'ai conservé ces codes" }).click();
	await expect(twoFactor.getByText(/^Activée\./u)).toBeVisible();

	return secret;
}

/**
 * Turns two-factor off whatever state the test left the page in, signed out
 * included: `two-factor.spec.ts` and the `ceiling` project start from it off.
 */
async function turnTwoFactorOff(page: Page, secret: string) {
	await page.goto("/settings/security");
	const email = page.getByLabel("Adresse e-mail");
	await expect(email.or(section(page))).toBeVisible();

	if (await email.isVisible()) {
		await passwordStep(page);
		await page.getByLabel("Code de vérification").fill(totp(secret));
		await page.getByRole("button", { name: "Vérifier" }).click();
	}

	const twoFactor = section(page);
	await expect(twoFactor.getByText(/^(Activée|Désactivée)\./u)).toBeVisible();

	if (await twoFactor.getByText(/^Désactivée\./u).isVisible()) {
		return;
	}

	await twoFactor.getByLabel("Mot de passe").fill(NEW_PASSWORD);
	await twoFactor.getByRole("button", { name: "Désactiver la double authentification" }).click();
	await expect(twoFactor.getByText(/^Désactivée\./u)).toBeVisible();
}

/** Registers a client as an assistant does: no session, no origin. */
async function register(request: APIRequestContext, name: string): Promise<string> {
	const registered = await request.post("/api/auth/oauth2/register", {
		data: {
			client_name: name,
			redirect_uris: [REDIRECT_URI],
			application_type: "native",
			token_endpoint_auth_method: "none",
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
		},
	});
	expect(registered.status()).toBe(201);

	return z.object({ client_id: z.string() }).parse(await registered.json()).client_id;
}

/** Answers the assistant's loopback address and keeps what it received. */
async function catchCallback(page: Page): Promise<{ callback?: URL }> {
	// Filled by the route, which TypeScript cannot see run.
	const seen: { callback?: URL } = {};
	await page.route(`${REDIRECT_URI}**`, async (route) => {
		seen.callback = new URL(route.request().url());
		await route.fulfill({ status: 200, contentType: "text/plain", body: "ok" });
	});

	return seen;
}

function authorizeUrl(clientId: string, verifier: string): string {
	const query = new URLSearchParams({
		response_type: "code",
		client_id: clientId,
		redirect_uri: REDIRECT_URI,
		scope: "archant:read archant:write offline_access",
		state: "e2e",
		code_challenge: createHash("sha256").update(verifier).digest("base64url"),
		code_challenge_method: "S256",
		resource: MCP,
	});

	return `/api/auth/oauth2/authorize?${query.toString()}`;
}

const tokensBody = z.object({
	access_token: z.string(),
	refresh_token: z.string(),
	scope: z.string(),
});

const form = (fields: Record<string, string>) => ({ form: fields });

async function listTools(request: APIRequestContext, token: string) {
	return request.post(MCP, {
		headers: {
			authorization: `Bearer ${token}`,
			accept: "application/json, text/event-stream",
			"mcp-protocol-version": "2025-11-25",
		},
		data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
	});
}

/** The JSON-RPC result, sent as JSON or as one server-sent event. */
function resultOf(text: string): unknown {
	const data = text.includes("data: ")
		? text
				.split("\n")
				.filter((line) => line.startsWith("data: "))
				.map((line) => line.slice("data: ".length))
				.join("")
		: text;

	return z.object({ result: z.unknown() }).parse(JSON.parse(data)).result;
}

test("signed in with the password alone, the owner refuses an assistant, which gets access_denied and no code", async ({
	page,
	request,
}) => {
	const clientId = await register(request, "Agent refusé");
	const seen = await catchCallback(page);

	await page.goto(authorizeUrl(clientId, randomBytes(32).toString("base64url")));
	await expect(page).toHaveURL(/\/sign-in\?/u);
	await passwordStep(page);

	await expect(page).toHaveURL(/\/oauth\/consent\?/u);
	await expect(page.getByText("Agent refusé demande l'accès à Archant.")).toBeVisible();
	await page.getByRole("button", { name: "Refuser" }).click();

	await expect.poll(() => seen.callback?.searchParams.get("error")).toBe("access_denied");
	expect(seen.callback?.searchParams.has("code")).toBe(false);

	await page.unroute(`${REDIRECT_URI}**`);
	await page.goto("/settings/assistants");
	await expect(page.getByRole("heading", { level: 1, name: "Assistants IA" })).toBeVisible();
	await expect(page.getByText("Aucun assistant connecté")).toBeVisible();
	await expect(page.getByText("Agent refusé")).toHaveCount(0);
});

test("an assistant registers, the owner signs in with a code and allows read only, then disconnects it", async ({
	page,
	context,
	request,
}) => {
	let secret = "";

	try {
		secret = await turnTwoFactorOn(page);
		await connectThenDisconnect(page, context, request, secret);
	} finally {
		if (secret !== "") {
			await turnTwoFactorOff(page, secret);
		}
	}
});

async function connectThenDisconnect(
	page: Page,
	context: BrowserContext,
	request: APIRequestContext,
	secret: string,
) {
	const clientId = await register(request, "Agent de test");

	// The owner starts signed out, as in a browser the assistant opens.
	await context.clearCookies();
	const seen = await catchCallback(page);
	const verifier = randomBytes(32).toString("base64url");

	await page.goto(authorizeUrl(clientId, verifier));
	await expect(page).toHaveURL(/\/sign-in\?/u);
	await passwordStep(page);
	await page.getByLabel("Code de vérification").fill(totp(secret));
	await page.getByRole("button", { name: "Vérifier" }).click();

	await expect(page).toHaveURL(/\/oauth\/consent\?/u);
	await expect(page.getByText("Agent de test demande l'accès à Archant.")).toBeVisible();
	await expect(page.getByText(/sur 127\.0\.0\.1:33418\./u)).toBeVisible();
	await expect(
		page.getByLabel("Lire vos comptes, vos opérations, vos règles, vos budgets et vos factures"),
	).toBeChecked();
	const write = page.getByLabel(
		"Créer et modifier vos règles, classer vos opérations, définir vos budgets, gérer vos factures",
	);
	await expect(write).toBeChecked();
	await write.uncheck();
	await page.getByRole("button", { name: "Autoriser" }).click();

	await expect.poll(() => seen.callback?.searchParams.get("state")).toBe("e2e");
	const code = seen.callback?.searchParams.get("code") ?? "";

	// The assistant exchanges its code from the command line: a form, no origin.
	const exchanged = await request.post(
		"/api/auth/oauth2/token",
		form({
			grant_type: "authorization_code",
			code,
			code_verifier: verifier,
			redirect_uri: REDIRECT_URI,
			client_id: clientId,
			resource: MCP,
		}),
	);
	expect(exchanged.status()).toBe(200);
	const tokens = tokensBody.parse(await exchanged.json());
	expect(tokens.scope).toBe("archant:read offline_access");

	const listed = await listTools(request, tokens.access_token);
	expect(listed.status()).toBe(200);
	const { tools } = z
		.object({ tools: z.array(z.object({ name: z.string() })) })
		.parse(resultOf(await listed.text()));
	expect(tools.map((tool) => tool.name)).toEqual(READ_TOOLS);

	// A write tool is refused to a read-only token before the SDK runs.
	const refused = await request.post(MCP, {
		headers: {
			authorization: `Bearer ${tokens.access_token}`,
			accept: "application/json, text/event-stream",
			"mcp-protocol-version": "2025-11-25",
		},
		data: {
			jsonrpc: "2.0",
			id: 2,
			method: "tools/call",
			params: {
				name: "create_rule",
				arguments: { conditions: [], actions: [{ actionType: "exclude_transaction" }] },
			},
		},
	});
	expect(refused.status()).toBe(403);
	expect(refused.headers()["www-authenticate"]).toContain('error="insufficient_scope"');

	// The consent left the owner signed in: « Réglages › Assistants IA ».
	await page.unroute(`${REDIRECT_URI}**`);
	await page.goto("/settings/assistants");
	await expect(page.getByRole("heading", { level: 1, name: "Assistants IA" })).toBeVisible();
	await expect(page.getByText(`${WEB_URL}/api/mcp`)).toBeVisible();
	const row = page.getByRole("list", { name: "Assistants connectés" }).getByRole("listitem");
	await expect(row).toHaveCount(1);
	await expect(row).toContainText("Agent de test");
	await expect(row).toContainText("Lecture seule");

	await row.getByRole("button", { name: "Déconnecter Agent de test" }).click();
	await page.getByRole("alertdialog").getByRole("button", { name: "Déconnecter" }).click();
	await expect(page.getByText("Agent de test est déconnecté.")).toBeVisible();
	await expect(page.getByText("Aucun assistant connecté")).toBeVisible();

	// The access token has minutes left, and is refused at once; so is the refresh token.
	expect((await listTools(request, tokens.access_token)).status()).toBe(401);
	const refreshed = await request.post(
		"/api/auth/oauth2/token",
		form({
			grant_type: "refresh_token",
			refresh_token: tokens.refresh_token,
			client_id: clientId,
			resource: MCP,
		}),
	);
	expect(refreshed.status()).toBe(400);
	expect(await refreshed.json()).toMatchObject({ error: "invalid_grant" });
}
