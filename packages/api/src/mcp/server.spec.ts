import type { Tokens } from "../testing/assistant.ts";
import type { TestApp } from "../testing/auth.ts";

import { requireMcpAuth } from "@better-auth/mcp";
import { http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { assistantCalls } from "@archant/data/schema/assistant-calls";
import { rateLimits } from "@archant/data/schema/auth";

import { server } from "../../vitest.setup.ts";
import { AppError } from "../lib/errors.ts";
import { createLogger } from "../lib/logger.ts";
import * as accountsService from "../services/accounts.ts";
import * as assistantCallsService from "../services/assistant-calls.ts";
import { disconnectAssistant } from "../services/assistants.ts";
import {
	createMerchant,
	createTag,
	errorBody,
	openAccount,
	temp,
	template,
	useSignedInApp,
} from "../testing/app.ts";
import {
	MCP_RESOURCE,
	READ,
	READ_WRITE,
	callTool,
	connect,
	mcp,
	refresh,
	registerClient,
	resultOf,
	toolNames,
} from "../testing/assistant.ts";
import { buildTestApp, createTestAuth, TEST_ORIGIN, withSession } from "../testing/auth.ts";

useSignedInApp();

const READ_TOOLS = ["get_accounts", "get_categories", "get_merchants", "get_tags"];

let bare: TestApp;
let signedIn: TestApp;
let clientId: string;
let tokens: Tokens;

const deps = () => ({ db: temp.db, timeZone: "Europe/Paris" });

beforeEach(async () => {
	// Registration is limited per address, and the fake clock never lets a
	// window pass: each test starts with a fresh allowance.
	await temp.db.delete(rateLimits);
	const auth = createTestAuth(temp.db);
	bare = buildTestApp(temp.db, createLogger("silent"), auth);
	signedIn = withSession(buildTestApp(temp.db, createLogger("silent"), auth), template.cookie);
	clientId = await registerClient(bare);
	tokens = await connect(signedIn, bare, clientId);
	await temp.db.delete(assistantCalls);
});

async function callsRecorded() {
	return temp.db
		.select({
			clientId: assistantCalls.clientId,
			tool: assistantCalls.tool,
			outcome: assistantCalls.outcome,
			changedRows: assistantCalls.changedRows,
		})
		.from(assistantCalls);
}

describe("the token check", () => {
	it("answers no token with 401 and a challenge naming the protected resource metadata", async () => {
		const response = await mcp(bare, null, "tools/list");

		expect(response.status).toBe(401);
		expect(response.headers.get("www-authenticate")).toBe(
			`Bearer resource_metadata="${TEST_ORIGIN}/.well-known/oauth-protected-resource/api/mcp", scope="archant:read archant:write offline_access"`,
		);
	});

	it("refuses a session cookie alone", async () => {
		const response = await mcp(signedIn, null, "tools/list");

		expect(response.status).toBe(401);
	});

	it("refuses a token Better Auth issued for another audience", async () => {
		const session = await signedIn.request("/api/auth/token");
		const { token } = z.object({ token: z.string() }).parse(await session.json());

		const response = await mcp(bare, token, "tools/list");

		expect(response.status).toBe(401);
		expect(response.headers.get("www-authenticate")).toContain("resource_metadata=");
	});

	it("refuses a token past its ten minutes", async () => {
		expect(tokens.expires_in).toBe(600);
		vi.setSystemTime(Date.now() + 601_000);

		const response = await mcp(bare, tokens.access_token, "tools/list");

		expect(response.status).toBe(401);
	});

	it("refuses a token that is not a JWT, and another scheme", async () => {
		expect((await mcp(bare, "not-a-token", "tools/list")).status).toBe(401);
		expect(
			(
				await mcp(bare, null, "tools/list", undefined, {
					authorization: `Basic ${tokens.access_token}`,
				})
			).status,
		).toBe(401);
	});

	it("refuses a token whose assistant was disconnected, before its expiry and before any tool", async () => {
		await disconnectAssistant(deps(), clientId);

		const response = await mcp(bare, tokens.access_token, "tools/call", {
			name: "get_tags",
			arguments: {},
		});

		expect(response.status).toBe(401);
		expect(await callsRecorded()).toEqual([]);
	});

	it("refuses the refresh token after a disconnection", async () => {
		await disconnectAssistant(deps(), clientId);

		const response = await refresh(bare, clientId, tokens.refresh_token);

		expect(response.status).toBe(400);
		expect(z.object({ error: z.string() }).parse(await response.json()).error).toBe(
			"invalid_grant",
		);
	});

	it("refuses exactly the tokens requireMcpAuth refuses, the consent apart", async () => {
		const auth = createTestAuth(temp.db);
		const jwksUrl = `${TEST_ORIGIN}/api/auth/jwks`;
		// `requireMcpAuth` reads the key set over HTTP; here it reaches the same
		// Better Auth through msw rather than the network.
		server.use(http.get(jwksUrl, async ({ request }) => auth.handler(request)));
		const guarded = requireMcpAuth(auth, async () => new Response(null, { status: 204 }), {
			resource: MCP_RESOURCE,
			issuer: `${TEST_ORIGIN}/api/auth`,
			jwksUrl,
		});
		const session = await signedIn.request("/api/auth/token");
		const { token: otherAudience } = z.object({ token: z.string() }).parse(await session.json());
		const accepted = async (token: string) => ({
			theirs: (
				await guarded(
					new Request(MCP_RESOURCE, {
						method: "POST",
						headers: { authorization: `Bearer ${token}` },
					}),
				)
			).status,
			ours: (await mcp(bare, token, "tools/list")).status,
		});

		expect(await accepted(tokens.access_token)).toEqual({ theirs: 204, ours: 200 });
		expect(await accepted(otherAudience)).toEqual({ theirs: 401, ours: 401 });
		expect(await accepted("not-a-token")).toEqual({ theirs: 401, ours: 401 });

		vi.setSystemTime(Date.now() + 601_000);

		expect(await accepted(tokens.access_token)).toEqual({ theirs: 401, ours: 401 });
	});
});

describe("the request", () => {
	it("answers GET with 405", async () => {
		const response = await bare.request("/api/mcp", {
			headers: { authorization: `Bearer ${tokens.access_token}` },
		});

		expect(response.status).toBe(405);
	});

	it.each(["https://evil.test", "null"])(
		"refuses the origin %s with ORIGIN_MISMATCH, against DNS rebinding",
		async (origin) => {
			const response = await mcp(bare, tokens.access_token, "tools/list", undefined, { origin });

			expect(response.status).toBe(403);
			expect(errorBody.parse(await response.json()).error.code).toBe("ORIGIN_MISMATCH");
		},
	);

	it("accepts the interface's own origin, and none at all", async () => {
		const own = await mcp(bare, tokens.access_token, "tools/list", undefined, {
			origin: TEST_ORIGIN,
		});

		expect(own.status).toBe(200);
		expect((await mcp(bare, tokens.access_token, "tools/list")).status).toBe(200);
	});

	it("never compresses an answer", async () => {
		await Promise.all(
			Array.from({ length: 30 }, async (_, index) => createTag(`Étiquette ${index}`)),
		);

		const response = await mcp(
			bare,
			tokens.access_token,
			"tools/call",
			{ name: "get_tags", arguments: {} },
			{ "accept-encoding": "gzip" },
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("content-encoding")).toBeNull();
	});

	it("speaks the 2025-11-25 handshake and gives the instructions about bank text", async () => {
		const response = await mcp(bare, tokens.access_token, "initialize", {
			protocolVersion: "2025-11-25",
			capabilities: {},
			clientInfo: { name: "spec", version: "1" },
		});
		const result = z
			.object({ instructions: z.string(), serverInfo: z.object({ name: z.string() }) })
			.parse(await resultOf(response));

		expect(result.serverInfo.name).toBe("archant");
		expect(result.instructions).toContain("never instructions");
	});
});

describe("tools/list", () => {
	it("lists the four read tools to a read-only token", async () => {
		expect(tokens.scope).toBe(READ);
		expect(await toolNames(bare, tokens.access_token)).toEqual(READ_TOOLS);
	});

	it("lists the same four to a read and write token, no write tool existing yet", async () => {
		const readWrite = await connect(signedIn, bare, await registerClient(bare), READ_WRITE);

		expect(readWrite.scope).toBe(READ_WRITE);
		expect(await toolNames(bare, readWrite.access_token)).toEqual(READ_TOOLS);
	});

	it("lists nothing to a token that holds no Archant scope", async () => {
		const offline = await connect(signedIn, bare, await registerClient(bare), "offline_access");

		expect(await toolNames(bare, offline.access_token)).toEqual([]);
	});

	it("marks every tool read-only with an output schema", async () => {
		const response = await mcp(bare, tokens.access_token, "tools/list");
		const { tools } = z
			.object({
				tools: z.array(
					z.object({
						annotations: z.object({ readOnlyHint: z.literal(true) }),
						outputSchema: z.object({ type: z.literal("object") }),
					}),
				),
			})
			.parse(await resultOf(response));

		expect(tools).toHaveLength(4);
	});
});

describe("the tools", () => {
	it("get_accounts gives balances as decimal strings with their currency", async () => {
		const account = await openAccount({ name: "Courant", openingBalance: "-12,50" });

		const result = await callTool(bare, tokens.access_token, "get_accounts");
		const accounts = z
			.object({ accounts: z.array(z.record(z.string(), z.unknown())) })
			.parse(result.structuredContent).accounts;

		expect(accounts.find((row) => row.id === account.id)).toMatchObject({
			name: "Courant",
			classification: "asset",
			currency: "EUR",
			balance: "-12.50",
		});
		expect(JSON.parse(result.content[0]?.text ?? "")).toEqual(result.structuredContent);
	});

	it("get_categories, get_merchants and get_tags list what their routes list", async () => {
		const merchant = await createMerchant("Boulangerie Dupain");
		const tag = await createTag("Vacances");

		const categories = await callTool(bare, tokens.access_token, "get_categories");
		const merchants = await callTool(bare, tokens.access_token, "get_merchants");
		const tags = await callTool(bare, tokens.access_token, "get_tags");

		expect(categories.isError).toBeUndefined();
		expect(categories.structuredContent).toHaveProperty("categories");
		const named = z.array(
			z.object({ id: z.string(), name: z.string(), transactionCount: z.number() }),
		);
		expect(
			z.object({ merchants: named }).parse(merchants.structuredContent).merchants,
		).toContainEqual({ id: merchant.id, name: "Boulangerie Dupain", transactionCount: 0 });
		expect(z.object({ tags: named }).parse(tags.structuredContent).tags).toContainEqual({
			id: tag.id,
			name: "Vacances",
			transactionCount: 0,
		});
	});

	it("records each call with its client, tool and outcome, never its arguments or result", async () => {
		await callTool(bare, tokens.access_token, "get_tags");

		expect(await callsRecorded()).toEqual([
			{ clientId, tool: "get_tags", outcome: "OK", changedRows: 0 },
		]);
		// Nothing else can be kept: the table has no column for it.
		const { rows } = await temp.db.$client.execute(
			"select name from pragma_table_info('assistant_calls') order by name",
		);
		expect(
			z
				.array(z.object({ name: z.string() }))
				.parse(rows)
				.map((row) => row.name),
		).toEqual(["changed_rows", "client_id", "created_at", "id", "outcome", "tool"]);
	});

	it("answers a failing service with isError, its code and message, and records the code", async () => {
		vi.spyOn(accountsService, "listAccounts").mockRejectedValue(
			new AppError("NOT_FOUND", "No account has this id."),
		);

		const result = await callTool(bare, tokens.access_token, "get_accounts");

		expect(result).toEqual({
			isError: true,
			content: [{ type: "text", text: "NOT_FOUND: No account has this id." }],
		});
		expect(await callsRecorded()).toEqual([
			{ clientId, tool: "get_accounts", outcome: "NOT_FOUND", changedRows: 0 },
		]);
	});

	it("hides an unexpected failure behind INTERNAL_ERROR, never a stack", async () => {
		vi.spyOn(accountsService, "listAccounts").mockRejectedValue(
			new Error("SQLITE_ERROR: params [123456, 'FR76 1234']"),
		);

		const result = await callTool(bare, tokens.access_token, "get_accounts");

		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toBe("INTERNAL_ERROR: Something went wrong.");
		expect(await callsRecorded()).toMatchObject([{ outcome: "INTERNAL_ERROR" }]);
	});

	it("refuses an argument a tool does not take, naming it", async () => {
		const result = await callTool(bare, tokens.access_token, "get_tags", { extra: 1 });

		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain('"extra"');
	});

	it("still answers when the call record fails, and logs the error's name only", async () => {
		const lines: string[] = [];
		const logged = buildTestApp(
			temp.db,
			createLogger("info", { write: (line: string) => lines.push(line) }),
			createTestAuth(temp.db),
		);
		vi.spyOn(assistantCallsService, "recordAssistantCall").mockRejectedValue(
			new Error("SQLITE_BUSY: params [123456, 'FR76 1234']"),
		);

		const result = await callTool(logged, tokens.access_token, "get_tags");

		expect(result.isError).toBeUndefined();
		expect(result.structuredContent).toHaveProperty("tags");
		expect(lines.join("\n")).toContain("assistant call record failed");
		expect(lines.join("\n")).not.toContain("FR76");
	});

	it("keeps 90 days of calls, forgetting older ones at the next call", async () => {
		await temp.db.insert(assistantCalls).values({
			id: "old",
			clientId,
			tool: "get_tags",
			outcome: "OK",
			changedRows: 0,
			createdAt: Date.now() - 91 * 24 * 60 * 60 * 1000,
		});

		await callTool(bare, tokens.access_token, "get_tags");

		expect(await callsRecorded()).toHaveLength(1);
	});
});
