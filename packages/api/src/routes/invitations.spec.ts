import type { Auth } from "../services/auth.ts";
import type { TestApp, TestNetwork } from "../testing/auth.ts";

import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createLogger } from "../lib/logger.ts";
import { errorBody, ownDatabase, temp, template, useSignedInApp } from "../testing/app.ts";
import {
	ADMIN,
	TEST_ORIGIN,
	addViewer,
	buildTestApp,
	createTestAuth,
	withSession,
} from "../testing/auth.ts";

useSignedInApp();

let auth: Auth;
let viewerCookie: string;
let logLines: string[] = [];

const logger = createLogger("info", { write: (line: string) => logLines.push(line) });

// One Better Auth and one viewer sign-in for the file: the limit allows three per ten seconds.
beforeAll(async () => {
	auth = createTestAuth(temp.db, logger);
	viewerCookie = await addViewer(buildTestApp(temp.db, logger, auth), auth);
});

const DAY_MS = 24 * 60 * 60 * 1000;

const createdBody = z.object({
	data: z.strictObject({
		id: z.string(),
		email: z.string(),
		role: z.string(),
		expiresAt: z.number(),
		url: z.string(),
	}),
});

const listBody = z.object({
	data: z.array(
		z.strictObject({ id: z.string(), email: z.string(), role: z.string(), expiresAt: z.number() }),
	),
});

const admin = (db = temp.db): TestApp =>
	withSession(buildTestApp(db, logger, db === temp.db ? auth : undefined), template.cookie);

const viewer = (): TestApp => withSession(buildTestApp(temp.db, logger, auth), viewerCookie);

/** No session: the person who opened the link. */
const visitor = (network: TestNetwork = {}): TestApp =>
	buildTestApp(temp.db, logger, auth, network);

/** A new address per test, so no file's emails ever meet. */
const uniqueEmail = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}@example.test`;

async function send(
	app: TestApp,
	method: string,
	path: string,
	body?: unknown,
	headers: Record<string, string> = {},
) {
	const response = await app.request(path, {
		method,
		headers: { "content-type": "application/json", origin: TEST_ORIGIN, ...headers },
		...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
	});

	return { response, body: z.unknown().parse(await response.json().catch(() => null)) };
}

async function invite(email: string, role = "viewer", app = admin()) {
	const { response, body } = await send(app, "POST", "/api/invitations", { email, role });

	expect(response.status, JSON.stringify(body)).toBe(201);

	const data = createdBody.parse(body).data;

	return { ...data, token: data.url.slice(`${TEST_ORIGIN}/invitations/`.length) };
}

const preview = async (token: string, app = visitor()) =>
	send(app, "POST", "/api/invitations/preview", { token });

const accept = async (
	token: string,
	body: { name?: string; password?: string } = {},
	app = visitor(),
	headers: Record<string, string> = {},
) =>
	send(
		app,
		"POST",
		"/api/invitations/accept",
		{ token, password: "un mot de passe", ...body },
		headers,
	);

async function invitationRows(email: string) {
	return temp.db.all<{ id: string; tokenHash: string; acceptedAt: number | null }>(
		sql`select id, token_hash as tokenHash, accepted_at as acceptedAt from invitations where email = ${email} order by created_at`,
	);
}

async function userOf(email: string) {
	const rows = await temp.db.all<{ name: string; role: string }>(
		sql`select name, role from users where email = ${email}`,
	);

	return rows[0];
}

/** A client a trusted proxy names. */
const from = (address: string) => ({ "x-forwarded-for": address });

const invalidBody = {
	error: { code: "INVITATION_INVALID", message: "This invitation is no longer valid." },
};

describe("POST /api/invitations", () => {
	it("invites an email, answers the link once, and stores only its token's SHA-256", async () => {
		logLines = [];
		const email = uniqueEmail("camille");

		const created = await invite(` ${email.toUpperCase()} `);

		expect(created).toMatchObject({
			email,
			role: "viewer",
			expiresAt: Date.now() + 3 * DAY_MS,
		});
		expect(created.url).toMatch(/^http:\/\/localhost:5173\/invitations\/[\w-]{43}$/u);
		expect(Buffer.from(created.token, "base64url")).toHaveLength(32);
		await expect(invitationRows(email)).resolves.toEqual([
			{
				id: created.id,
				tokenHash: createHash("sha256").update(created.token).digest("hex"),
				acceptedAt: null,
			},
		]);
		// The id only: never the email, the token or the link.
		const logs = logLines.join("\n");
		expect(logs).toContain(created.id);
		expect(logs).not.toContain(created.token);
		expect(logs).not.toMatch(/camille/iu);
	});

	it("invites as an administrator", async () => {
		await expect(invite(uniqueEmail("dominique"), "admin")).resolves.toMatchObject({
			role: "admin",
		});
	});

	it("refuses an email that has a user, whatever its case, and stores nothing", async () => {
		const { response, body } = await send(admin(), "POST", "/api/invitations", {
			email: ADMIN.email.toUpperCase(),
			role: "viewer",
		});

		expect(response.status).toBe(400);
		expect(body).toEqual({
			error: {
				code: "VALIDATION_ERROR",
				message: "The request is invalid.",
				fields: [{ path: "email", code: "user_exists" }],
			},
		});
		await expect(invitationRows(ADMIN.email)).resolves.toEqual([]);
	});

	it("refuses a second invitation of a pending email", async () => {
		const email = uniqueEmail("pending");
		await invite(email);

		const { response, body } = await send(admin(), "POST", "/api/invitations", {
			email,
			role: "admin",
		});

		expect(response.status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([
			{ path: "email", code: "invitation_pending" },
		]);
		await expect(invitationRows(email)).resolves.toHaveLength(1);
	});

	it("replaces an expired invitation of the email, and deletes every other expired one", async () => {
		const email = uniqueEmail("expired");
		const other = uniqueEmail("forgotten");
		const first = await invite(email);
		await invite(other);
		const accepted = await invite(uniqueEmail("joined"));
		await accept(accepted.token);
		vi.setSystemTime(Date.now() + 3 * DAY_MS);

		const second = await invite(email);

		await expect(invitationRows(email)).resolves.toEqual([
			expect.objectContaining({ id: second.id }),
		]);
		expect(second.id).not.toBe(first.id);
		await expect(invitationRows(other)).resolves.toEqual([]);
		await expect(invitationRows(accepted.email)).resolves.toHaveLength(1);
	});

	it.each([
		[{ email: "camille", role: "viewer" }, "email", "invalid_email"],
		[{ email: " ", role: "viewer" }, "email", "too_small"],
		[{ email: "camille@example.test", role: "owner" }, "role", "invalid_value"],
	])("refuses %j with its field code", async (json, path, code) => {
		const { response, body } = await send(admin(), "POST", "/api/invitations", json);

		expect(response.status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([{ path, code }]);
	});
});

describe("GET /api/invitations", () => {
	it("lists the pending invitations only, the soonest to expire first", async () => {
		const own = await ownDatabase();
		const app = admin(own.db);
		const create = async (email: string) => {
			const { body } = await send(app, "POST", "/api/invitations", { email, role: "viewer" });

			return createdBody.parse(body).data;
		};
		const expired = await create("expired@example.test");
		vi.setSystemTime(Date.now() + DAY_MS);
		const accepted = await create("accepted@example.test");
		await own.db.run(sql`update invitations set accepted_at = 1 where id = ${accepted.id}`);
		const older = await create("older@example.test");
		vi.setSystemTime(Date.now() + DAY_MS);
		const newer = await create("newer@example.test");
		vi.setSystemTime(Date.now() + DAY_MS);

		const { response, body } = await send(app, "GET", "/api/invitations");

		expect(response.status).toBe(200);
		expect(listBody.parse(body).data).toEqual([
			{ id: older.id, email: "older@example.test", role: "viewer", expiresAt: older.expiresAt },
			{ id: newer.id, email: "newer@example.test", role: "viewer", expiresAt: newer.expiresAt },
		]);
		expect(expired.expiresAt).toBeLessThanOrEqual(Date.now());
	});

	it("refuses a visitor without a session", async () => {
		const { response } = await send(visitor(), "GET", "/api/invitations");

		expect(response.status).toBe(401);
	});
});

describe("DELETE /api/invitations/:id", () => {
	it("revokes a pending invitation, whose link then answers INVITATION_INVALID", async () => {
		const created = await invite(uniqueEmail("revoked"));

		const { response, body } = await send(admin(), "DELETE", `/api/invitations/${created.id}`);

		expect(response.status).toBe(200);
		expect(body).toEqual({ data: null });
		await expect(invitationRows(created.email)).resolves.toEqual([]);
		const previewed = await preview(created.token);
		expect(previewed.response.status).toBe(404);
		expect(previewed.body).toEqual(invalidBody);
		expect((await accept(created.token)).response.status).toBe(404);
	});

	it("answers NOT_FOUND for an unknown, an accepted or an expired invitation", async () => {
		const acceptedOne = await invite(uniqueEmail("accepted"));
		await accept(acceptedOne.token);
		const expiredOne = await invite(uniqueEmail("expired"));
		vi.setSystemTime(Date.now() + 3 * DAY_MS);

		const statuses = await Promise.all(
			["nope", acceptedOne.id, expiredOne.id].map(async (id) => {
				const { response, body } = await send(admin(), "DELETE", `/api/invitations/${id}`);

				return `${response.status} ${errorBody.parse(body).error.code}`;
			}),
		);

		expect(statuses).toEqual(["404 NOT_FOUND", "404 NOT_FOUND", "404 NOT_FOUND"]);
	});
});

describe("an administrator's invitations", () => {
	it("refuse a viewer to create, list or revoke", async () => {
		const created = await invite(uniqueEmail("kept"));

		const answers = await Promise.all([
			send(viewer(), "POST", "/api/invitations", { email: uniqueEmail("x"), role: "admin" }),
			send(viewer(), "GET", "/api/invitations"),
			send(viewer(), "DELETE", `/api/invitations/${created.id}`),
		]);

		expect(answers.map(({ response }) => response.status)).toEqual([403, 403, 403]);
		expect(answers.map(({ body }) => errorBody.parse(body).error.code)).toEqual([
			"FORBIDDEN",
			"FORBIDDEN",
			"FORBIDDEN",
		]);
		await expect(invitationRows(created.email)).resolves.toHaveLength(1);
	});

	it("refuse a visitor without a session behind a public path's name", async () => {
		const created = await invite(uniqueEmail("public"));

		const { response } = await send(visitor(), "DELETE", "/api/invitations/preview");
		const accepted = await send(visitor(), "DELETE", "/api/invitations/accept");

		expect([response.status, accepted.response.status]).toEqual([403, 403]);
		await expect(invitationRows(created.email)).resolves.toHaveLength(1);
	});
});

describe("POST /api/invitations/preview", () => {
	it("names the email, the role and the inviter by email when they have no name", async () => {
		const created = await invite(uniqueEmail("preview"), "admin");

		const { response, body } = await preview(created.token);

		expect(response.status).toBe(200);
		expect(body).toEqual({
			data: { email: created.email, role: "admin", inviterName: ADMIN.email },
		});
	});

	it("names the inviter by their first name when they have one", async () => {
		const own = await ownDatabase();
		await own.db.run(sql`update users set name = 'Camille' where email = ${ADMIN.email}`);
		const { body: created } = await send(admin(own.db), "POST", "/api/invitations", {
			email: "dominique@example.test",
			role: "viewer",
		});
		const token = createdBody.parse(created).data.url.split("/").at(-1) ?? "";

		const { body } = await send(buildTestApp(own.db, logger), "POST", "/api/invitations/preview", {
			token,
		});

		expect(body).toEqual({
			data: { email: "dominique@example.test", role: "viewer", inviterName: "Camille" },
		});
	});

	it.each([
		["an unknown token", "not-a-token"],
		["an empty token", ""],
		["a token of 201 characters", "x".repeat(201)],
	])("answers INVITATION_INVALID to %s, previewed or accepted", async (_name, token) => {
		const previewed = await preview(token);
		const accepted = await accept(token);

		expect([previewed.response.status, accepted.response.status]).toEqual([404, 404]);
		expect(previewed.body).toEqual(invalidBody);
		expect(accepted.body).toEqual(invalidBody);
	});

	it("answers INVITATION_INVALID once the invitation expired", async () => {
		const created = await invite(uniqueEmail("late"));
		vi.setSystemTime(Date.now() + 3 * DAY_MS);

		const previewed = await preview(created.token);
		const accepted = await accept(created.token);

		expect([previewed.response.status, accepted.response.status]).toEqual([404, 404]);
		expect(accepted.body).toEqual(invalidBody);
		await expect(invitationRows(created.email)).resolves.toEqual([
			expect.objectContaining({ acceptedAt: null }),
		]);
	});
});

describe("POST /api/invitations/accept", () => {
	it("creates the user with the invitation's email and role, and signs them in", async () => {
		logLines = [];
		const created = await invite(uniqueEmail("accept"));

		const { response, body } = await accept(created.token, { name: " Camille " });

		expect(response.status).toBe(201);
		expect(body).toEqual({ data: { signedIn: true } });
		await expect(userOf(created.email)).resolves.toEqual({ name: "Camille", role: "viewer" });
		await expect(invitationRows(created.email)).resolves.toEqual([
			expect.objectContaining({ acceptedAt: Date.now() }),
		]);
		const cookie = response.headers
			.getSetCookie()
			.map((line) => line.split(";")[0])
			.join("; ");
		const accounts = await withSession(buildTestApp(temp.db, logger, auth), cookie).request(
			"/api/accounts",
		);
		expect(accounts.status).toBe(200);
		// Ids only: never the email, the token or the password.
		const logs = logLines.join("\n");
		expect(logs).toContain(created.id);
		expect(logs).not.toContain(created.token);
		expect(logs).not.toMatch(/accept-|un mot de passe/u);
	});

	it("creates an administrator from an administrator's invitation, with no name", async () => {
		const created = await invite(uniqueEmail("admin"), "admin");

		const { response } = await accept(created.token);

		expect(response.status).toBe(201);
		await expect(userOf(created.email)).resolves.toEqual({ name: "", role: "admin" });
	});

	it("answers INVITATION_INVALID to the same link again", async () => {
		const created = await invite(uniqueEmail("replay"));
		await accept(created.token);

		const again = await accept(created.token, { password: "un autre mot de passe" });
		const previewed = await preview(created.token);

		expect(again.response.status).toBe(404);
		expect(again.body).toEqual(invalidBody);
		expect(previewed.response.status).toBe(404);
	});

	it("answers INVITATION_INVALID to an unknown token, and creates no user", async () => {
		const { response, body } = await accept("not-a-token");

		expect(response.status).toBe(404);
		expect(body).toEqual(invalidBody);
	});

	it("lets one of two concurrent acceptances through", async () => {
		const created = await invite(uniqueEmail("race"));

		const answers = await Promise.all([accept(created.token), accept(created.token)]);

		expect(answers.map(({ response }) => response.status).toSorted((a, b) => a - b)).toEqual([
			201, 404,
		]);
		await expect(
			temp.db.all(sql`select id from users where email = ${created.email}`),
		).resolves.toHaveLength(1);
	});

	it("releases the invitation when creating the user fails, so its link still works", async () => {
		const created = await invite(uniqueEmail("retry"));
		vi.spyOn(auth.api, "createUser").mockRejectedValueOnce(new Error("SQLITE_BUSY"));

		const failed = await accept(created.token);

		expect(failed.response.status).toBe(500);
		await expect(invitationRows(created.email)).resolves.toEqual([
			expect.objectContaining({ acceptedAt: null }),
		]);
		await expect(userOf(created.email)).resolves.toBeUndefined();
		expect((await preview(created.token)).response.status).toBe(200);
		expect((await accept(created.token)).response.status).toBe(201);
	});

	it("still answers 201 when the sign-in fails, without a session", async () => {
		const created = await invite(uniqueEmail("signin"));
		vi.spyOn(auth.api, "signInEmail").mockRejectedValueOnce(new Error("SQLITE_BUSY"));

		const { response, body } = await accept(created.token);

		expect(response.status).toBe(201);
		expect(body).toEqual({ data: { signedIn: false } });
		expect(response.headers.getSetCookie()).toEqual([]);
		await expect(userOf(created.email)).resolves.toEqual({ name: "", role: "viewer" });
	});

	it.each([
		[{ password: "1234567" }, "password", "password_too_short"],
		[{ password: "x".repeat(129) }, "password", "password_too_long"],
		[{ name: "x".repeat(61) }, "name", "too_big"],
	])(
		"refuses %j with its field code, and keeps the invitation pending",
		async (json, path, code) => {
			const created = await invite(uniqueEmail("invalid"));

			const { response, body } = await accept(created.token, json);

			expect(response.status).toBe(400);
			expect(errorBody.parse(body).error.fields).toEqual([{ path, code }]);
			await expect(invitationRows(created.email)).resolves.toEqual([
				expect.objectContaining({ acceptedAt: null }),
			]);
		},
	);

	it("answers TOO_MANY_REQUESTS to a fourth attempt in ten seconds, before reading the body", async () => {
		const created = await invite(uniqueEmail("limit"));
		// One app, so one limiter, behind a trusted proxy that names each client.
		const app = visitor({ peer: "127.0.0.1", trustedProxies: ["127.0.0.1"] });

		const statuses = [
			(await accept("guess-0", {}, app, from("203.0.113.7"))).response.status,
			(await accept("guess-1", {}, app, from("203.0.113.7"))).response.status,
			(await accept("guess-2", {}, app, from("203.0.113.7"))).response.status,
		];
		const fourth = await send(
			app,
			"POST",
			"/api/invitations/accept",
			"not json",
			from("203.0.113.7"),
		);

		expect(statuses).toEqual([404, 404, 404]);
		expect(fourth.response.status).toBe(429);
		expect(errorBody.parse(fourth.body).error.code).toBe("TOO_MANY_REQUESTS");
		// The right token is refused too until the window ends; another address is not.
		expect((await accept(created.token, {}, app, from("203.0.113.7"))).response.status).toBe(429);
		expect((await accept(created.token, {}, app, from("198.51.100.1"))).response.status).toBe(201);
	});
});

describe("public sign-up", () => {
	it("stays refused", async () => {
		const email = uniqueEmail("signup");

		const { response } = await send(visitor(), "POST", "/api/auth/sign-up/email", {
			email,
			password: "un mot de passe",
			name: "",
		});

		expect(response.status).toBeGreaterThanOrEqual(400);
		await expect(userOf(email)).resolves.toBeUndefined();
	});
});
