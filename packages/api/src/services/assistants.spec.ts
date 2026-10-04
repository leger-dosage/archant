import type { TestApp } from "../testing/auth.ts";
import type { Auth } from "./auth.ts";

import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { rateLimits, users } from "@archant/data/schema/auth";
import {
	oauthAccessTokens,
	oauthClients,
	oauthConsents,
	oauthRefreshTokens,
} from "@archant/data/schema/oauth";

import { createLogger } from "../lib/logger.ts";
import { own, ownDatabase, template, useSignedInApp } from "../testing/app.ts";
import { READ_WRITE, connect, registerClient } from "../testing/assistant.ts";
import {
	ADMIN,
	buildTestApp,
	cookieOf,
	createTestAuth,
	signIn,
	withSession,
} from "../testing/auth.ts";
import { recordAssistantCall } from "./assistant-calls.ts";
import { disconnectAssistant, grantedScopes, listAssistants } from "./assistants.ts";

useSignedInApp();

let bare: TestApp;
let signedIn: TestApp;
let auth: Auth;

const deps = () => {
	if (own === undefined) {
		throw new Error("Each test owns its database.");
	}

	return { db: own.db, timeZone: "Europe/Paris" };
};

beforeEach(async () => {
	const { db } = await ownDatabase();
	await db.delete(rateLimits);
	auth = createTestAuth(db);
	bare = buildTestApp(db, createLogger("silent"), auth);
	signedIn = withSession(buildTestApp(db, createLogger("silent"), auth), template.cookie);
});

async function ownerId(): Promise<string> {
	const owner = await deps()
		.db.select({ id: users.id })
		.from(users)
		.where(eq(users.email, ADMIN.email))
		.get();

	return owner?.id ?? "";
}

describe("listAssistants", () => {
	it("lists nothing before an assistant connects", async () => {
		expect(await listAssistants(deps(), await ownerId())).toEqual([]);
	});

	it("names each connected assistant with its scopes, connection date and last call", async () => {
		const reader = await registerClient(bare, "Claude Code");
		await connect(signedIn, bare, reader);
		vi.setSystemTime(new Date("2026-09-22T08:00:00Z"));
		const writer = await registerClient(bare, "Cursor");
		await connect(signedIn, bare, writer, READ_WRITE);
		await recordAssistantCall(
			deps(),
			{ clientId: writer, tool: "get_tags", outcome: "OK", changedRows: 0 },
			Date.parse("2026-09-22T09:00:00Z"),
		);
		await recordAssistantCall(
			deps(),
			{ clientId: writer, tool: "get_tags", outcome: "OK", changedRows: 0 },
			Date.parse("2026-09-22T10:00:00Z"),
		);

		expect(await listAssistants(deps(), await ownerId())).toEqual([
			{
				clientId: reader,
				name: "Claude Code",
				scopes: ["archant:read"],
				connectedAt: Date.parse("2026-09-21T10:00:00Z"),
				lastCallAt: null,
			},
			{
				clientId: writer,
				name: "Cursor",
				scopes: ["archant:read", "archant:write"],
				connectedAt: Date.parse("2026-09-22T08:00:00Z"),
				lastCallAt: Date.parse("2026-09-22T10:00:00Z"),
			},
		]);
	});

	it("leaves out a client that registered but was never allowed", async () => {
		await registerClient(bare);

		expect(await listAssistants(deps(), await ownerId())).toEqual([]);
	});
});

describe("disconnectAssistant", () => {
	it("deletes the consent and every token, and keeps the client row", async () => {
		const clientId = await registerClient(bare);
		await connect(signedIn, bare, clientId);
		const other = await registerClient(bare, "Cursor");
		await connect(signedIn, bare, other);

		await disconnectAssistant(deps(), await ownerId(), clientId);

		const { db } = deps();
		const of = (table: typeof oauthConsents | typeof oauthRefreshTokens) =>
			db.select().from(table).where(eq(table.clientId, clientId));
		expect(await of(oauthConsents)).toEqual([]);
		expect(await of(oauthRefreshTokens)).toEqual([]);
		expect(
			await db.select().from(oauthAccessTokens).where(eq(oauthAccessTokens.clientId, clientId)),
		).toEqual([]);
		expect(
			await db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId)),
		).toHaveLength(1);
		expect(
			(await listAssistants(deps(), await ownerId())).map((assistant) => assistant.clientId),
		).toEqual([other]);
		expect(
			await db.select().from(oauthRefreshTokens).where(eq(oauthRefreshTokens.clientId, other)),
		).toHaveLength(1);
	});

	it("refuses an assistant that holds no consent with ASSISTANT_NOT_FOUND", async () => {
		const clientId = await registerClient(bare);

		await expect(disconnectAssistant(deps(), await ownerId(), clientId)).rejects.toMatchObject({
			code: "ASSISTANT_NOT_FOUND",
		});
		await expect(disconnectAssistant(deps(), await ownerId(), "unknown")).rejects.toMatchObject({
			code: "ASSISTANT_NOT_FOUND",
		});
	});

	it("writes nothing when a delete fails midway", async () => {
		const clientId = await registerClient(bare);
		await connect(signedIn, bare, clientId);
		const { db } = deps();
		// The consent goes first, the refresh tokens last: failing there must
		// put the consent back.
		await db.run(
			sql`create trigger refuse_refresh_delete before delete on oauth_refresh_tokens begin select raise(abort, 'disk full'); end`,
		);

		await expect(disconnectAssistant(deps(), await ownerId(), clientId)).rejects.toThrow();
		expect(await listAssistants(deps(), await ownerId())).toHaveLength(1);
	});
});

describe("grantedScopes", () => {
	it("gives the scopes the owner allowed, and null once disconnected", async () => {
		const clientId = await registerClient(bare);
		await connect(signedIn, bare, clientId, READ_WRITE);
		const userId = await ownerId();

		expect(await grantedScopes(deps(), clientId, userId)).toEqual([
			"archant:read",
			"archant:write",
		]);
		expect(await grantedScopes(deps(), clientId, "someone-else")).toBeNull();

		await disconnectAssistant(deps(), await ownerId(), clientId);

		expect(await grantedScopes(deps(), clientId, userId)).toBeNull();
	});
});

/** A second administrator, signed in: their id and the app that sends their session. */
async function secondAdmin() {
	const credentials = { email: "second@example.test", password: "a long passphrase" };
	const { user } = await auth.api.createUser({
		body: { ...credentials, name: "", data: { role: "admin" } },
	});
	const response = await signIn(bare, credentials);

	return {
		id: user.id,
		app: withSession(buildTestApp(deps().db, createLogger("silent"), auth), cookieOf(response)),
	};
}

describe("two administrators", () => {
	it("each list their own assistants, a client both allowed included", async () => {
		const second = await secondAdmin();
		const shared = await registerClient(bare, "Claude Code");
		const theirs = await registerClient(bare, "Cursor");
		await connect(signedIn, bare, shared);
		await connect(second.app, bare, shared, READ_WRITE);
		vi.setSystemTime(new Date("2026-09-21T11:00:00Z"));
		await connect(second.app, bare, theirs);

		const mine = await listAssistants(deps(), await ownerId());
		const others = await listAssistants(deps(), second.id);

		expect(mine.map((assistant) => [assistant.clientId, assistant.scopes])).toEqual([
			[shared, ["archant:read"]],
		]);
		expect(others.map((assistant) => [assistant.clientId, assistant.scopes])).toEqual([
			[shared, ["archant:read", "archant:write"]],
			[theirs, ["archant:read"]],
		]);
	});

	it("never disconnect each other's assistants", async () => {
		const second = await secondAdmin();
		const shared = await registerClient(bare, "Claude Code");
		const theirs = await registerClient(bare, "Cursor");
		await connect(signedIn, bare, shared);
		await connect(second.app, bare, shared);
		vi.setSystemTime(new Date("2026-09-21T11:00:00Z"));
		await connect(second.app, bare, theirs);
		const owner = await ownerId();

		await expect(disconnectAssistant(deps(), owner, theirs)).rejects.toMatchObject({
			code: "ASSISTANT_NOT_FOUND",
		});
		await disconnectAssistant(deps(), owner, shared);

		expect(await listAssistants(deps(), owner)).toEqual([]);
		expect(
			(await listAssistants(deps(), second.id)).map((assistant) => assistant.clientId),
		).toEqual([shared, theirs]);
		expect(
			await deps()
				.db.select({ userId: oauthRefreshTokens.userId })
				.from(oauthRefreshTokens)
				.where(eq(oauthRefreshTokens.clientId, shared)),
		).toEqual([{ userId: second.id }]);
		expect(await grantedScopes(deps(), shared, second.id)).toEqual(["archant:read"]);
	});
});
