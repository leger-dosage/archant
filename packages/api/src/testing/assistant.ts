import type { TestApp } from "./auth.ts";

import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

import { TEST_ORIGIN } from "./auth.ts";

/** Where a command-line assistant listens for its code, as Claude Code does. */
export const REDIRECT_URI = "http://127.0.0.1:33418/callback";

export const MCP_RESOURCE = `${TEST_ORIGIN}/api/mcp`;

export const READ = "archant:read offline_access";

export const READ_WRITE = "archant:read archant:write offline_access";

const registered = z.object({ client_id: z.string() });

const tokens = z.object({
	access_token: z.string(),
	refresh_token: z.string(),
	expires_in: z.number(),
	scope: z.string(),
});

export type Tokens = z.infer<typeof tokens>;

const form = (fields: Record<string, string>): RequestInit => ({
	method: "POST",
	headers: { "content-type": "application/x-www-form-urlencoded" },
	body: new URLSearchParams(fields).toString(),
});

/**
 * Registers a public client the way a command-line assistant does: no
 * session, no origin, a loopback redirect. Returns its `client_id`.
 */
export async function registerClient(bare: TestApp, name = "Claude Code"): Promise<string> {
	const response = await bare.request("/api/auth/oauth2/register", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			client_name: name,
			redirect_uris: [REDIRECT_URI],
			application_type: "native",
			token_endpoint_auth_method: "none",
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
		}),
	});

	if (response.status !== 201) {
		throw new Error(`Registration failed with ${response.status}: ${await response.text()}`);
	}

	return registered.parse(await response.json()).client_id;
}

/** A PKCE pair: the verifier the client keeps, the S256 challenge it sends. */
export function pkce(): { verifier: string; challenge: string } {
	const verifier = randomBytes(32).toString("base64url");

	return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function authorizeQuery(clientId: string, challenge: string, scope = READ_WRITE): string {
	return new URLSearchParams({
		response_type: "code",
		client_id: clientId,
		redirect_uri: REDIRECT_URI,
		scope,
		state: "state",
		code_challenge: challenge,
		code_challenge_method: "S256",
		resource: MCP_RESOURCE,
	}).toString();
}

/**
 * Connects `clientId` as the owner would: the authorisation request asks for
 * read and write, the consent grants `granted`, and the code is exchanged
 * without an origin, as a command-line client sends it.
 */
export async function connect(
	signedIn: TestApp,
	bare: TestApp,
	clientId: string,
	granted = READ,
): Promise<Tokens> {
	const { verifier, challenge } = pkce();
	const authorize = await signedIn.request(
		`/api/auth/oauth2/authorize?${authorizeQuery(clientId, challenge)}`,
	);
	const consentPage = new URL(authorize.headers.get("location") ?? "", TEST_ORIGIN);

	if (consentPage.pathname !== "/oauth/consent") {
		throw new Error(`Authorisation went to ${consentPage.pathname}, not the consent page.`);
	}

	const consent = await signedIn.request("/api/auth/oauth2/consent", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			accept: true,
			scope: granted,
			oauth_query: consentPage.search.slice(1),
		}),
	});
	const { url } = z.object({ url: z.string() }).parse(await consent.json());
	const code = new URL(url).searchParams.get("code") ?? "";

	const exchanged = await bare.request(
		"/api/auth/oauth2/token",
		form({
			grant_type: "authorization_code",
			code,
			code_verifier: verifier,
			redirect_uri: REDIRECT_URI,
			client_id: clientId,
			resource: MCP_RESOURCE,
		}),
	);

	if (exchanged.status !== 200) {
		throw new Error(`Token exchange failed with ${exchanged.status}: ${await exchanged.text()}`);
	}

	return tokens.parse(await exchanged.json());
}

export async function refresh(
	bare: TestApp,
	clientId: string,
	refreshToken: string,
): Promise<Response> {
	return bare.request(
		"/api/auth/oauth2/token",
		form({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			client_id: clientId,
			resource: MCP_RESOURCE,
		}),
	);
}

let nextId = 1;

/** One JSON-RPC request to `/api/mcp`, as a 2025-11-25 client sends it after `initialize`. */
export async function mcp(
	app: TestApp,
	token: string | null,
	method: string,
	params?: unknown,
	headers: Record<string, string> = {},
): Promise<Response> {
	return app.request("/api/mcp", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			"mcp-protocol-version": "2025-11-25",
			...(token === null ? {} : { authorization: `Bearer ${token}` }),
			...headers,
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: nextId++,
			method,
			...(params === undefined ? {} : { params }),
		}),
	});
}

const rpcResult = z.object({ result: z.record(z.string(), z.unknown()) });

/** The JSON-RPC result of an answer, sent as JSON or as one server-sent event. */
export async function resultOf(response: Response): Promise<Record<string, unknown>> {
	const text = await response.text();
	const data = (response.headers.get("content-type") ?? "").includes("text/event-stream")
		? text
				.split("\n")
				.filter((line) => line.startsWith("data: "))
				.map((line) => line.slice("data: ".length))
				.join("")
		: text;

	return rpcResult.parse(JSON.parse(data)).result;
}

const toolList = z.object({ tools: z.array(z.object({ name: z.string() })) });

export async function toolNames(app: TestApp, token: string): Promise<string[]> {
	const response = await mcp(app, token, "tools/list");

	return toolList.parse(await resultOf(response)).tools.map((tool) => tool.name);
}

const toolResult = z.object({
	isError: z.boolean().optional(),
	content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
	structuredContent: z.record(z.string(), z.unknown()).optional(),
});

export async function callTool(app: TestApp, token: string, name: string, args: unknown = {}) {
	const response = await mcp(app, token, "tools/call", { name, arguments: args });

	return toolResult.parse(await resultOf(response));
}

/** A tool's JSON answer, read from its one text block: what Sure answers, a refusal included. */
export function answerOf(result: { content: readonly { text: string }[] }): unknown {
	return JSON.parse(result.content[0]?.text ?? "null");
}
