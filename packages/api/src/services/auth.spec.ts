import type { SignedInTemplate, TestApp } from "../testing/auth.ts";
import type { TempDatabase } from "../testing/temp-database.ts";
import type { Auth } from "./auth.ts";
import type { Table } from "drizzle-orm";

import { getAuthTables } from "better-auth/db";
import { eq, getTableColumns } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { rateLimits, signInFailures } from "@archant/data/schema/auth";
import { jwks, oauthConsents } from "@archant/data/schema/oauth";

import { createLogger } from "../lib/logger.ts";
import {
	MCP_RESOURCE,
	REDIRECT_URI,
	authorizeQuery,
	connect,
	pkce,
	refresh,
	registerClient,
} from "../testing/assistant.ts";
import {
	ADMIN,
	TEST_ORIGIN,
	buildTestApp,
	createSignedInTemplate,
	createTestAuth,
	signIn,
	TEST_SECRET,
	withSession,
} from "../testing/auth.ts";
import { createTempDatabase } from "../testing/temp-database.ts";
import { AUTH_SCHEMA, assistantsAvailable, createAuth } from "./auth.ts";
import * as deviceCookie from "./device-cookie.ts";
import { DEVICE_COOKIE, signDeviceCookie, verifyDeviceCookie } from "./device-cookie.ts";
import * as ceiling from "./sign-in-failures.ts";
import { SIGN_IN_CEILING } from "./sign-in-failures.ts";

// Behind a trusted loopback proxy, so each request names its own address.
const TRUSTED_PROXIES = ["127.0.0.1", "::1"];
const NETWORK = { peer: "::ffff:127.0.0.1", trustedProxies: TRUSTED_PROXIES };
const WRONG = { email: ADMIN.email, password: "wrong password" };

let template: SignedInTemplate;
let temp: TempDatabase;

// Every copy holds the administrator: one sign-in for the whole file.
beforeAll(async () => {
	template = await createSignedInTemplate();
});

afterAll(async () => {
	await template.dispose();
});

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-09-27T10:00:00Z"));
	temp = await createTempDatabase(template.file);
	// The template's sign-in opened a ceiling window on the real clock. Kept,
	// it would hold the fake clock's window open until ten minutes after the
	// template was made, and the window assertions below would depend on the
	// time of day the suite runs.
	await temp.db.delete(signInFailures);
});

afterEach(async () => {
	vi.restoreAllMocks();
	vi.useRealTimers();
	await temp.dispose();
});

const silent = createLogger("silent");

/** A server process: its own Better Auth instance, on `temp`'s database. */
function startServer(): { app: TestApp; auth: Auth } {
	const auth = createTestAuth(temp.db, silent, TRUSTED_PROXIES);

	return { app: buildTestApp(temp.db, silent, auth, NETWORK), auth };
}

async function signInFrom(
	app: TestApp,
	address: string,
	credentials: { email: string; password: string },
): Promise<number> {
	const response = await app.request("/api/auth/sign-in/email", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			origin: TEST_ORIGIN,
			"x-forwarded-for": address,
		},
		body: JSON.stringify(credentials),
	});

	return response.status;
}

/** One failure from each of `count` addresses at once, never two from the same. */
async function failFromMany(app: TestApp, count: number): Promise<number[]> {
	return Promise.all(
		Array.from({ length: count }, (_, index) => signInFrom(app, `198.51.100.${index + 1}`, WRONG)),
	);
}

const failures = async () => temp.db.select().from(signInFailures);

describe("the per-address sign-in limit", () => {
	it("refuses a fourth attempt in 10 seconds across a restart, its counts in the database", async () => {
		const before = startServer();
		const statuses = [
			await signInFrom(before.app, "198.51.100.1", WRONG),
			await signInFrom(before.app, "198.51.100.1", WRONG),
			await signInFrom(before.app, "198.51.100.1", WRONG),
		];

		const after = startServer();

		expect(statuses).toEqual([401, 401, 401]);
		expect(await signInFrom(after.app, "198.51.100.1", ADMIN)).toBe(429);
		// Stored, not held in the process: Better Auth's memory store is shared
		// by every instance of one process, so the restart alone proves nothing.
		const rows = await temp.db.select().from(rateLimits);
		expect(rows.find((row) => row.key.includes("198.51.100.1"))?.count).toBe(3);
	});
});

describe("the overall sign-in ceiling", () => {
	it("refuses the right password from a new address once 20 addresses failed, without calling Better Auth", async () => {
		const { app, auth } = startServer();

		expect(await failFromMany(app, SIGN_IN_CEILING.max)).toEqual(
			Array.from({ length: 20 }, () => 401),
		);

		const handler = vi.spyOn(auth, "handler");
		const response = await app.request("/api/auth/sign-in/email", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: TEST_ORIGIN,
				"x-forwarded-for": "203.0.113.50",
			},
			body: JSON.stringify(ADMIN),
		});

		expect(response.status).toBe(429);
		await expect(response.json()).resolves.toMatchObject({
			error: { code: "TOO_MANY_REQUESTS" },
		});
		expect(handler).not.toHaveBeenCalled();
		// A refusal is not a failure: the window's count stays where it was.
		await expect(failures()).resolves.toMatchObject([{ count: 20 }]);
	});

	it("still refuses after a restart", async () => {
		await failFromMany(startServer().app, 20);

		expect(await signInFrom(startServer().app, "203.0.113.50", ADMIN)).toBe(429);
	});

	it("accepts a sign-in once the 10-minute window is over, and counts again from 0", async () => {
		const { app } = startServer();
		await failFromMany(app, 20);

		vi.setSystemTime(new Date("2026-09-27T10:09:59Z"));
		expect(await signInFrom(app, "203.0.113.50", ADMIN)).toBe(429);

		vi.setSystemTime(new Date("2026-09-27T10:10:00Z"));
		expect(await signInFrom(app, "203.0.113.51", ADMIN)).toBe(200);
		expect(await signInFrom(app, "203.0.113.52", WRONG)).toBe(401);
		await expect(failures()).resolves.toEqual([
			{ id: "all", count: 1, windowStartedAt: Date.parse("2026-09-27T10:10:00Z") },
		]);
	});

	it("never counts a successful sign-in", async () => {
		const { app } = startServer();

		// One after the other: each holds a slot until Better Auth answers, so
		// 25 at once would meet the ceiling while in flight.
		const statuses = await Array.from({ length: 25 }).reduce<Promise<number[]>>(
			async (previous, _, index) => [
				...(await previous),
				await signInFrom(app, `203.0.113.${index + 1}`, ADMIN),
			],
			Promise.resolve([]),
		);

		expect(statuses).toEqual(Array.from({ length: 25 }, () => 200));
		await expect(failures()).resolves.toMatchObject([{ count: 0 }]);
	});

	it("lets exactly 20 of 25 parallel wrong attempts from 25 addresses reach Better Auth", async () => {
		const { app, auth } = startServer();
		const handler = vi.spyOn(auth, "handler");

		const statuses = await failFromMany(app, 25);

		expect(handler).toHaveBeenCalledTimes(20);
		expect(statuses.filter((status) => status === 401)).toHaveLength(20);
		expect(statuses.filter((status) => status === 429)).toHaveLength(5);
		await expect(failures()).resolves.toMatchObject([{ count: 20 }]);
	});

	it("keeps Better Auth's answer when giving the slot back fails, and logs the error's name only", async () => {
		const lines: string[] = [];
		const logger = createLogger("info", { write: (line: string) => lines.push(line) });
		const app = buildTestApp(
			temp.db,
			logger,
			createTestAuth(temp.db, logger, TRUSTED_PROXIES),
			NETWORK,
		);
		vi.spyOn(ceiling, "releaseAttempt").mockRejectedValue(
			new Error(`SQLITE_BUSY ${ADMIN.email} 203.0.113.50`),
		);

		expect(await signInFrom(app, "203.0.113.50", ADMIN)).toBe(200);
		const logged = lines.join("\n");
		expect(logged).toContain("releasing a slot failed");
		expect(logged).toContain('"error":"Error"');
		expect(logged).not.toContain(ADMIN.email);
		expect(logged).not.toContain("203.0.113.50");
	});

	it("does not count Better Auth's own refusal of a fourth attempt", async () => {
		const { app } = startServer();
		const statuses = [
			await signInFrom(app, "198.51.100.1", WRONG),
			await signInFrom(app, "198.51.100.1", WRONG),
			await signInFrom(app, "198.51.100.1", WRONG),
			await signInFrom(app, "198.51.100.1", WRONG),
		];

		expect(statuses).toEqual([401, 401, 401, 429]);
		await expect(failures()).resolves.toMatchObject([{ count: 3 }]);
	});
});

/** A sign-in from `address`, carrying `cookie` when given. */
async function signInWith(
	app: TestApp,
	address: string,
	credentials: { email: string; password: string },
	cookie?: string,
): Promise<Response> {
	return app.request("/api/auth/sign-in/email", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			origin: TEST_ORIGIN,
			"x-forwarded-for": address,
			...(cookie === undefined ? {} : { cookie }),
		},
		body: JSON.stringify(credentials),
	});
}

/** The `Set-Cookie` line of the device cookie a response sets, if any. */
function deviceLine(response: Response): string | undefined {
	return response.headers.getSetCookie().find((line) => line.startsWith(`${DEVICE_COOKIE}=`));
}

/** The device cookie a response sets, as a `Cookie` header. */
function deviceCookieOf(response: Response): string {
	const line = deviceLine(response);

	if (line === undefined) {
		throw new Error(`No device cookie in ${response.status}`);
	}

	return line.split(";")[0] ?? "";
}

const nonceOf = (cookie: string) =>
	verifyDeviceCookie(TEST_SECRET, cookie.slice(DEVICE_COOKIE.length + 1))?.nonce;

/** A device that signed in once, before the ceiling filled. */
async function knownDevice(app: TestApp): Promise<string> {
	const response = await signInWith(app, "192.0.2.1", ADMIN);

	expect(response.status).toBe(200);

	return deviceCookieOf(response);
}

const deviceRow = async (cookie: string) =>
	temp.db
		.select()
		.from(signInFailures)
		.where(eq(signInFailures.id, `device:${nonceOf(cookie)}`));

const globalCount = async () =>
	(await temp.db.select().from(signInFailures).where(eq(signInFailures.id, "all")))[0]?.count;

describe("the device cookie a sign-in sets", () => {
	it("is set by a sign-in without two-factor: HttpOnly, SameSite=Strict, under /api/auth, for a year", async () => {
		const { app } = startServer();

		const response = await signInWith(app, "192.0.2.1", ADMIN);

		expect(response.status).toBe(200);
		const line = deviceLine(response) ?? "";
		expect(line).toMatch(/; Max-Age=31536000(?:;|$)/u);
		expect(line).toMatch(/; Path=\/api\/auth(?:;|$)/u);
		expect(line).toMatch(/; HttpOnly(?:;|$)/u);
		expect(line).toMatch(/; SameSite=Strict(?:;|$)/u);
		// `BETTER_AUTH_URL` is plain HTTP in tests.
		expect(line).not.toMatch(/; Secure(?:;|$)/u);
		const device = verifyDeviceCookie(TEST_SECRET, deviceCookieOf(response).split("=")[1] ?? "");
		expect(device).toMatchObject({ expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000 });
	});

	it("is not set by a failed sign-in", async () => {
		const response = await signInWith(startServer().app, "192.0.2.1", WRONG);

		expect(response.status).toBe(401);
		expect(deviceLine(response)).toBeUndefined();
	});
});

describe("a known device once the ceiling is full", () => {
	it("signs in with the right password, and gets a new cookie", async () => {
		const { app, auth } = startServer();
		const cookie = await knownDevice(app);
		await failFromMany(app, 20);
		const handler = vi.spyOn(auth, "handler");

		const response = await signInWith(app, "203.0.113.50", ADMIN, cookie);

		expect(response.status).toBe(200);
		expect(handler).toHaveBeenCalledOnce();
		const renewed = deviceCookieOf(response);
		expect(nonceOf(renewed)).toEqual(expect.any(String));
		expect(nonceOf(renewed)).not.toBe(nonceOf(cookie));
		// No global slot taken, none given back, and no failure on the device.
		expect(await globalCount()).toBe(20);
		await expect(deviceRow(cookie)).resolves.toMatchObject([{ count: 0 }]);
	});

	it("signs in with the email typed in another case, as Better Auth matches it", async () => {
		const { app } = startServer();
		const cookie = await knownDevice(app);
		await failFromMany(app, 20);

		const response = await signInWith(
			app,
			"203.0.113.50",
			{ email: ADMIN.email.toUpperCase(), password: ADMIN.password },
			cookie,
		);

		expect(response.status).toBe(200);
	});

	it("counts a wrong password as one failure on its nonce, never on the global row", async () => {
		const { app } = startServer();
		const cookie = await knownDevice(app);
		await failFromMany(app, 20);

		expect((await signInWith(app, "203.0.113.50", WRONG, cookie)).status).toBe(401);
		await expect(deviceRow(cookie)).resolves.toMatchObject([{ count: 1 }]);
		expect(await globalCount()).toBe(20);
	});

	it("is refused the right password once it failed 5 times in the window", async () => {
		const { app, auth } = startServer();
		const cookie = await knownDevice(app);
		await failFromMany(app, 20);
		const failed = await failFromDevice(app, cookie);
		const handler = vi.spyOn(auth, "handler");

		const response = await signInWith(app, "203.0.113.50", ADMIN, cookie);

		expect(failed).toEqual([401, 401, 401, 401, 401]);
		expect(response.status).toBe(429);
		await expect(response.json()).resolves.toMatchObject({ error: { code: "TOO_MANY_REQUESTS" } });
		expect(handler).not.toHaveBeenCalled();
	});

	it("leaves the other devices' allowance whole when one device spent its own", async () => {
		const { app } = startServer();
		const spent = await knownDevice(app);
		const other = deviceCookieOf(await signInWith(app, "192.0.2.2", ADMIN));
		await failFromMany(app, 20);
		await failFromDevice(app, spent);

		expect((await signInWith(app, "203.0.113.50", ADMIN, spent)).status).toBe(429);
		expect((await signInWith(app, "203.0.113.51", ADMIN, other)).status).toBe(200);
	});

	it("is still held to Better Auth's three attempts per address", async () => {
		const { app } = startServer();
		const cookie = await knownDevice(app);
		await failFromMany(app, 20);

		const statuses = [
			(await signInWith(app, "203.0.113.50", WRONG, cookie)).status,
			(await signInWith(app, "203.0.113.50", WRONG, cookie)).status,
			(await signInWith(app, "203.0.113.50", WRONG, cookie)).status,
			(await signInWith(app, "203.0.113.50", ADMIN, cookie)).status,
		];

		expect(statuses).toEqual([401, 401, 401, 429]);
		// Better Auth's refusal is not a failure of the device either.
		await expect(deviceRow(cookie)).resolves.toMatchObject([{ count: 3 }]);
	});

	it("starts the device's count again in the next window", async () => {
		const { app } = startServer();
		const cookie = await knownDevice(app);
		await failFromMany(app, 20);
		await failFromDevice(app, cookie);

		vi.setSystemTime(new Date("2026-09-27T10:10:00Z"));

		expect((await signInWith(app, "203.0.113.50", ADMIN, cookie)).status).toBe(200);
	});
});

/** A device cookie the server could have signed for `userId`, as a `Cookie` header. */
const signed = (userId: string, now = Date.now()) =>
	`${DEVICE_COOKIE}=${signDeviceCookie(TEST_SECRET, userId, now)}`;

/** Five failures of one device, each from an address of its own. */
async function failFromDevice(app: TestApp, cookie: string): Promise<number[]> {
	return Promise.all(
		[1, 2, 3, 4, 5].map(
			async (index) => (await signInWith(app, `203.0.113.${index}`, WRONG, cookie)).status,
		),
	);
}

describe("anything but a known device once the ceiling is full", () => {
	it.each([
		["no cookie", async () => undefined],
		[
			"a forged cookie",
			async (cookie: string) => `${cookie.slice(0, -2)}${cookie.endsWith("AA") ? "BB" : "AA"}`,
		],
		[
			"an expired cookie",
			async (cookie: string) => {
				const device = verifyDeviceCookie(TEST_SECRET, cookie.split("=")[1] ?? "");

				return signed(device?.userId ?? "", Date.now() - 366 * 24 * 60 * 60 * 1000);
			},
		],
		["another user's cookie", async () => signed("another-user")],
	])("is refused with %s, Better Auth not called", async (_, cookieFor) => {
		const { app, auth } = startServer();
		const cookie = await cookieFor(await knownDevice(app));
		await failFromMany(app, 20);
		const handler = vi.spyOn(auth, "handler");

		const response = await signInWith(app, "203.0.113.50", ADMIN, cookie);

		expect(response.status).toBe(429);
		await expect(response.json()).resolves.toMatchObject({ error: { code: "TOO_MANY_REQUESTS" } });
		expect(handler).not.toHaveBeenCalled();
	});

	it("is refused for an email no user has, even with a valid cookie", async () => {
		const { app } = startServer();
		const cookie = await knownDevice(app);
		await failFromMany(app, 20);

		const response = await signInWith(
			app,
			"203.0.113.50",
			{ email: "someone@example.test", password: ADMIN.password },
			cookie,
		);

		expect(response.status).toBe(429);
	});

	it("is refused a body that is not JSON, even with a valid cookie", async () => {
		const { app, auth } = startServer();
		const cookie = await knownDevice(app);
		await failFromMany(app, 20);
		const handler = vi.spyOn(auth, "handler");

		const response = await app.request("/api/auth/sign-in/email", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: TEST_ORIGIN,
				"x-forwarded-for": "203.0.113.50",
				cookie,
			},
			body: "email=admin",
		});

		expect(response.status).toBe(429);
		expect(handler).not.toHaveBeenCalled();
	});

	it("does not read the cookie while the ceiling has room", async () => {
		const { app } = startServer();
		const known = vi.spyOn(deviceCookie, "knownDeviceNonce");

		const response = await signInWith(app, "203.0.113.50", ADMIN, signed("another-user"));

		expect(response.status).toBe(200);
		expect(known).not.toHaveBeenCalled();
	});
});

/** A signed-in browser and a command-line assistant, against one Better Auth. */
function assistantServer(options: Parameters<typeof createTestAuth>[3] = {}) {
	const auth = createTestAuth(temp.db, silent, [], options);

	return {
		auth,
		bare: buildTestApp(temp.db, silent, auth),
		signedIn: withSession(buildTestApp(temp.db, silent, auth), template.cookie),
	};
}

const metadata = z.object({
	issuer: z.string(),
	registration_endpoint: z.string(),
	code_challenge_methods_supported: z.array(z.string()),
	client_id_metadata_document_supported: z.boolean(),
	grant_types_supported: z.array(z.string()),
	scopes_supported: z.array(z.string()),
});

describe("the authorisation server's metadata", () => {
	it("advertises PKCE with S256, dynamic registration and Client ID Metadata Documents", async () => {
		const { bare } = assistantServer();

		const response = await bare.request("/.well-known/oauth-authorization-server/api/auth");

		expect(response.status).toBe(200);
		expect(metadata.parse(await response.json())).toEqual({
			issuer: `${TEST_ORIGIN}/api/auth`,
			registration_endpoint: `${TEST_ORIGIN}/api/auth/oauth2/register`,
			code_challenge_methods_supported: ["S256"],
			client_id_metadata_document_supported: true,
			grant_types_supported: ["authorization_code", "refresh_token"],
			scopes_supported: ["archant:read", "archant:write", "offline_access"],
		});
	});

	it("describes /api/mcp as a protected resource of this server", async () => {
		const { bare } = assistantServer();

		const response = await bare.request("/.well-known/oauth-protected-resource/api/mcp");

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			resource: MCP_RESOURCE,
			authorization_servers: [`${TEST_ORIGIN}/api/auth`],
			scopes_supported: ["archant:read", "archant:write"],
		});
	});
});

describe("client registration", () => {
	it.each(["/api/auth/oauth2/create-client", "/api/auth/oauth2/update-client"])(
		"disables %s, even for the signed-in owner",
		async (path) => {
			const { signedIn } = assistantServer();

			const response = await signedIn.request(path, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ redirect_uris: [REDIRECT_URI] }),
			});

			expect(response.status).toBe(404);
		},
	);

	it("registers a client from its Client ID Metadata Document, fetched through the transport given", async () => {
		const clientId = "https://assistant.example.com/oauth/client.json";
		const fetched: string[] = [];
		const { signedIn } = assistantServer({
			fetchClientMetadataResource: async (input) => {
				fetched.push(String(input));

				return Response.json({
					client_id: clientId,
					client_name: "Example assistant",
					redirect_uris: [REDIRECT_URI],
					token_endpoint_auth_method: "none",
					grant_types: ["authorization_code", "refresh_token"],
					response_types: ["code"],
				});
			},
		});
		const { challenge } = pkce();

		const response = await signedIn.request(
			`/api/auth/oauth2/authorize?${authorizeQuery(clientId, challenge)}`,
		);

		expect(fetched).toEqual([clientId]);
		expect(new URL(response.headers.get("location") ?? "", TEST_ORIGIN).pathname).toBe(
			"/oauth/consent",
		);
	});
});

describe("tokens", () => {
	it("issues a ten-minute JWT bound to /api/mcp and a refresh token", async () => {
		const { bare, signedIn } = assistantServer();
		const clientId = await registerClient(bare);

		const tokens = await connect(signedIn, bare, clientId);
		const [, payload] = tokens.access_token.split(".");
		const claims = z
			.object({
				aud: z.string(),
				iss: z.string(),
				azp: z.string(),
				exp: z.number(),
				iat: z.number(),
			})
			.parse(JSON.parse(Buffer.from(payload ?? "", "base64url").toString()));

		expect(claims).toMatchObject({
			aud: MCP_RESOURCE,
			iss: `${TEST_ORIGIN}/api/auth`,
			azp: clientId,
		});
		expect(claims.exp - claims.iat).toBe(600);
	});

	it("rotates the refresh token, and refuses the old one once the 30-second retry window is over", async () => {
		const { bare, signedIn } = assistantServer();
		const clientId = await registerClient(bare);
		const tokens = await connect(signedIn, bare, clientId);

		const rotated = await refresh(bare, clientId, tokens.refresh_token);
		const next = z.object({ refresh_token: z.string() }).parse(await rotated.json());

		expect(rotated.status).toBe(200);
		expect(next.refresh_token).not.toBe(tokens.refresh_token);

		vi.setSystemTime(Date.now() + 31_000);
		const replayed = await refresh(bare, clientId, tokens.refresh_token);

		expect(replayed.status).toBe(400);
		expect(await replayed.json()).toMatchObject({ error: "invalid_grant" });
	});

	it("still refreshes after Better Auth's own consent deletion: the gap disconnectAssistant closes", async () => {
		const { bare, signedIn } = assistantServer();
		const clientId = await registerClient(bare);
		const tokens = await connect(signedIn, bare, clientId);

		await temp.db.delete(oauthConsents).where(eq(oauthConsents.clientId, clientId));

		expect((await refresh(bare, clientId, tokens.refresh_token)).status).toBe(200);
	});
});

describe("a rotated BETTER_AUTH_SECRET", () => {
	it("leaves the stored signing key unreadable until its rows are deleted", async () => {
		const before = assistantServer();
		await connect(before.signedIn, before.bare, await registerClient(before.bare));
		const auth = createAuth({
			db: temp.db,
			secret: "another-secret-of-at-least-32-characters",
			baseURL: TEST_ORIGIN,
			trustedProxies: [],
			logger: silent,
		});
		const bare = buildTestApp(temp.db, silent, auth);
		// The old session cookie no longer verifies: the owner signs in again.
		const signedIn = withSession(
			buildTestApp(temp.db, silent, auth),
			(await signIn(bare, ADMIN)).headers
				.getSetCookie()
				.map((line) => line.split(";")[0])
				.join("; "),
		);

		await expect(connect(signedIn, bare, await registerClient(bare))).rejects.toThrow(
			"Token exchange failed with 500",
		);

		await temp.db.delete(jwks);

		await expect(connect(signedIn, bare, await registerClient(bare))).resolves.toHaveProperty(
			"access_token",
		);
	});
});

describe("the tables Better Auth writes", () => {
	it("are all declared, every field a column, every other column optional", async () => {
		const { auth } = assistantServer();
		// Its start seeds `/api/mcp` as a resource; done before the database closes.
		await auth.$context;
		const declared: Record<string, Table> = AUTH_SCHEMA;
		const problems: string[] = [];

		for (const table of Object.values(getAuthTables(auth.options))) {
			const key = `${table.modelName}s`;
			const drizzleTable = declared[key];

			if (drizzleTable === undefined) {
				problems.push(`no table for ${key}`);
				continue;
			}

			const columns = getTableColumns(drizzleTable);
			const written = new Set([
				"id",
				...Object.entries(table.fields).map(([name, field]) => field.fieldName ?? name),
			]);

			for (const field of written) {
				if (!(field in columns)) {
					problems.push(`${key}.${field} missing`);
				}
			}

			for (const [name, column] of Object.entries(columns)) {
				if (!written.has(name) && column.notNull && !column.hasDefault) {
					problems.push(`${key}.${name} required but never written`);
				}
			}
		}

		expect(problems).toEqual([]);
	});
});

describe("an address assistants cannot use", () => {
	it.each([
		["https://archant.example.com", true],
		["http://localhost:5173", true],
		["http://127.0.0.1:8787", true],
		["http://[::1]:8787", true],
		["http://nas.lan:8787", false],
		["http://192.168.1.10:8787", false],
	])("%s allows assistants: %s", (url, available) => {
		expect(assistantsAvailable(url)).toBe(available);
	});

	it("starts without assistants on plain HTTP: /api/mcp and the metadata answer 404", async () => {
		const origin = "http://nas.lan:8787";
		const app = buildTestApp(temp.db, silent, undefined, { origin });

		const mcp = await app.request("/api/mcp", { method: "POST", body: "{}" });
		const discovery = await app.request("/.well-known/oauth-protected-resource/api/mcp");
		const register = await app.request("/api/auth/oauth2/register", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		});

		expect(mcp.status).toBe(404);
		expect(discovery.status).toBe(404);
		expect(register.status).toBe(404);
	});
});
