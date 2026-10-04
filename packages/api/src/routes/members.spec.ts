import type { Auth } from "../services/auth.ts";
import type { TestApp } from "../testing/auth.ts";

import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { Database } from "@archant/data/client";
import { rateLimits, users } from "@archant/data/schema/auth";
import type { UserRole } from "@archant/data/user-roles";

import { createLogger } from "../lib/logger.ts";
import { removeMember, setMemberRole } from "../services/members.ts";
import { ownDatabase, template, useSignedInApp, valid } from "../testing/app.ts";
import { connect, registerClient } from "../testing/assistant.ts";
import {
	ADMIN,
	TEST_ORIGIN,
	buildTestApp,
	cookieOf,
	createTestAuth,
	signIn,
	withSession,
} from "../testing/auth.ts";

useSignedInApp();

let db: Database;
let auth: Auth;
let logLines: string[] = [];

const logger = createLogger("info", { write: (line: string) => logLines.push(line) });

// Each test owns its database, members included, and a fresh sign-in allowance.
beforeEach(async () => {
	db = (await ownDatabase()).db;
	await db.delete(rateLimits);
	auth = createTestAuth(db, logger);
	logLines = [];
});

const memberBody = z.strictObject({
	id: z.string(),
	name: z.string(),
	email: z.string(),
	role: z.string(),
	createdAt: z.number(),
});

const bare = (): TestApp => buildTestApp(db, logger, auth);

const as = (cookie: string): TestApp => withSession(bare(), cookie);

const admin = (): TestApp => as(template.cookie);

async function send(app: TestApp, method: string, path: string, body?: unknown) {
	const response = await app.request(path, {
		method,
		headers: { "content-type": "application/json", origin: TEST_ORIGIN },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});

	return { status: response.status, body: z.unknown().parse(await response.json()) };
}

const errorCode = (body: unknown) =>
	z.object({ error: z.object({ code: z.string() }) }).parse(body).error.code;

async function ownerId(): Promise<string> {
	const row = await db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.email, ADMIN.email))
		.get();

	return row?.id ?? "";
}

let created = 0;

/** A member created as an invitation would, then signed in: their id and session cookie. */
async function addMember(role: UserRole, name = "") {
	created += 1;
	const credentials = { email: `member-${created}@example.test`, password: "a long passphrase" };
	// Through `data`: without access-control roles, Better Auth types `role`
	// as its own `admin` or `user`, while it stores any string it is given.
	const { user } = await auth.api.createUser({ body: { ...credentials, name, data: { role } } });
	const response = await signIn(bare(), credentials);

	expect(response.status).toBe(200);

	return { id: user.id, email: credentials.email, cookie: cookieOf(response) };
}

const roleOf = async (id: string) =>
	(await db.select({ role: users.role }).from(users).where(eq(users.id, id)).get())?.role;

const countOf = async (table: string, userColumn: string, id: string) =>
	(
		await db.get<{ count: number }>(
			sql`select count(*) as count from ${sql.identifier(table)} where ${sql.identifier(userColumn)} = ${id}`,
		)
	)?.count;

const deps = () => ({ db, logger });

const createAccount = (app: TestApp) => send(app, "POST", "/api/accounts", valid);

describe("GET /api/members", () => {
	it("lists every member, the oldest first, with no secret column", async () => {
		// After the administrator, whose template was signed in on 2026-10-21.
		vi.setSystemTime(new Date("2026-10-22T08:00:00Z"));
		const camille = await addMember("viewer", "Camille");

		const { status, body } = await send(admin(), "GET", "/api/members");

		expect(status).toBe(200);
		expect(z.object({ data: z.array(memberBody) }).parse(body).data).toEqual([
			{
				id: await ownerId(),
				name: "",
				email: ADMIN.email,
				role: "admin",
				createdAt: Date.parse("2026-10-21T10:00:00Z"),
			},
			{
				id: camille.id,
				name: "Camille",
				email: camille.email,
				role: "viewer",
				createdAt: Date.parse("2026-10-22T08:00:00Z"),
			},
		]);
	});
});

describe("PATCH /api/members/:id", () => {
	it("promotes a viewer, whose next write goes through", async () => {
		const viewer = await addMember("viewer");

		expect((await createAccount(as(viewer.cookie))).status).toBe(403);

		const { status, body } = await send(admin(), "PATCH", `/api/members/${viewer.id}`, {
			role: "admin",
		});

		expect(status).toBe(200);
		expect(z.object({ data: memberBody }).parse(body).data).toMatchObject({
			id: viewer.id,
			role: "admin",
		});
		expect((await createAccount(as(viewer.cookie))).status).toBe(201);
	});

	it("demotes an administrator, deleting their assistants and pending invitations, and refuses their next write", async () => {
		const other = await addMember("admin");
		const owner = await ownerId();
		const clientId = await registerClient(bare());
		await connect(as(other.cookie), bare(), clientId);
		// The owner's own consent to the same client, and their own invitation, stay.
		await connect(admin(), bare(), clientId);
		const invited = await send(as(other.cookie), "POST", "/api/invitations", {
			email: "dominique@example.test",
			role: "viewer",
		});
		expect(invited.status).toBe(201);
		const ownInvitation = await send(admin(), "POST", "/api/invitations", {
			email: "eden@example.test",
			role: "viewer",
		});
		expect(ownInvitation.status).toBe(201);
		expect(await countOf("oauth_consents", "user_id", other.id)).toBe(1);
		expect(await countOf("oauth_refresh_tokens", "user_id", other.id)).toBe(1);
		logLines = [];

		const { status, body } = await send(admin(), "PATCH", `/api/members/${other.id}`, {
			role: "viewer",
		});

		expect(status, JSON.stringify(body)).toBe(200);
		expect(await countOf("oauth_consents", "user_id", other.id)).toBe(0);
		expect(await countOf("oauth_refresh_tokens", "user_id", other.id)).toBe(0);
		expect(await countOf("oauth_access_tokens", "user_id", other.id)).toBe(0);
		expect(await countOf("invitations", "inviter_id", other.id)).toBe(0);
		expect(await countOf("oauth_consents", "user_id", owner)).toBe(1);
		expect(await countOf("oauth_refresh_tokens", "user_id", owner)).toBe(1);
		expect(await countOf("invitations", "inviter_id", owner)).toBe(1);
		// Their session stays; their role changes at the next request.
		expect(await countOf("sessions", "user_id", other.id)).toBe(1);
		expect((await createAccount(as(other.cookie))).status).toBe(403);
		// Ids only: never an email or a name.
		const logs = logLines.join("\n");
		expect(logs).toContain(other.id);
		expect(logs).not.toContain("@example.test");
	});

	it("answers the member unchanged and deletes nothing when the role is the same", async () => {
		const other = await addMember("admin");
		const clientId = await registerClient(bare());
		await connect(as(other.cookie), bare(), clientId);

		const { status, body } = await send(admin(), "PATCH", `/api/members/${other.id}`, {
			role: "admin",
		});

		expect(status).toBe(200);
		expect(z.object({ data: memberBody }).parse(body).data.role).toBe("admin");
		expect(await countOf("oauth_consents", "user_id", other.id)).toBe(1);
	});

	it("refuses a role that does not exist", async () => {
		const viewer = await addMember("viewer");

		const { status, body } = await send(admin(), "PATCH", `/api/members/${viewer.id}`, {
			role: "owner",
		});

		expect(status).toBe(400);
		expect(errorCode(body)).toBe("VALIDATION_ERROR");
		expect(await roleOf(viewer.id)).toBe("viewer");
	});
});

describe("DELETE /api/members/:id", () => {
	it("removes a member, signs them out everywhere and deletes the invitations to their email", async () => {
		const invited = await send(admin(), "POST", "/api/invitations", {
			email: "camille@example.test",
			role: "viewer",
		});
		const token = z
			.object({ data: z.object({ url: z.string() }) })
			.parse(invited.body)
			.data.url.split("/")
			.at(-1);
		const accepted = await bare().request("/api/invitations/accept", {
			method: "POST",
			headers: { "content-type": "application/json", origin: TEST_ORIGIN },
			body: JSON.stringify({ token, password: "un mot de passe" }),
		});
		expect(accepted.status).toBe(201);
		const cookie = cookieOf(accepted);
		const member = await db
			.select({ id: users.id })
			.from(users)
			.where(eq(users.email, "camille@example.test"))
			.get();
		const id = member?.id ?? "";
		expect((await send(as(cookie), "GET", "/api/accounts")).status).toBe(200);

		const { status, body } = await send(admin(), "DELETE", `/api/members/${id}`);

		expect(status).toBe(200);
		expect(body).toEqual({ data: null });
		expect((await send(as(cookie), "GET", "/api/accounts")).status).toBe(401);
		expect(await countOf("users", "id", id)).toBe(0);
		expect(await countOf("sessions", "user_id", id)).toBe(0);
		expect(await countOf("auth_accounts", "user_id", id)).toBe(0);
		expect(await countOf("invitations", "email", "camille@example.test")).toBe(0);
	});

	it("removes an administrator with everything they connected and sent, and logs ids only", async () => {
		const other = await addMember("admin");
		const owner = await ownerId();
		const clientId = await registerClient(bare());
		await connect(as(other.cookie), bare(), clientId);
		await connect(admin(), bare(), clientId);
		const invited = await send(as(other.cookie), "POST", "/api/invitations", {
			email: "dominique@example.test",
			role: "admin",
		});
		expect(invited.status).toBe(201);
		logLines = [];

		const { status } = await send(admin(), "DELETE", `/api/members/${other.id}`);

		expect(status).toBe(200);
		expect(await countOf("oauth_consents", "user_id", other.id)).toBe(0);
		expect(await countOf("oauth_refresh_tokens", "user_id", other.id)).toBe(0);
		expect(await countOf("oauth_access_tokens", "user_id", other.id)).toBe(0);
		expect(await countOf("invitations", "inviter_id", other.id)).toBe(0);
		expect(await countOf("oauth_consents", "user_id", owner)).toBe(1);
		expect((await createAccount(as(other.cookie))).status).toBe(401);
		const logs = logLines.join("\n");
		expect(logs).toContain(other.id);
		expect(logs).not.toContain("@example.test");
	});
});

describe("the members routes", () => {
	it.each(["PATCH", "DELETE"])("refuse %s on the administrator's own id", async (method) => {
		const id = await ownerId();

		const { status, body } = await send(admin(), method, `/api/members/${id}`, {
			role: "viewer",
		});

		expect(status).toBe(409);
		expect(errorCode(body)).toBe("CANNOT_CHANGE_SELF");
		expect(await roleOf(id)).toBe("admin");
	});

	it.each(["PATCH", "DELETE"])("answer NOT_FOUND to %s on an unknown id", async (method) => {
		const { status, body } = await send(admin(), method, `/api/members/${crypto.randomUUID()}`, {
			role: "viewer",
		});

		expect(status).toBe(404);
		expect(errorCode(body)).toBe("NOT_FOUND");
	});

	it("refuse a viewer to list, change or remove", async () => {
		const viewer = await addMember("viewer");
		const id = await ownerId();

		const answers = await Promise.all([
			send(as(viewer.cookie), "GET", "/api/members"),
			send(as(viewer.cookie), "PATCH", `/api/members/${id}`, { role: "viewer" }),
			send(as(viewer.cookie), "DELETE", `/api/members/${id}`),
		]);

		expect(answers.map(({ status, body }) => [status, errorCode(body)])).toEqual([
			[403, "FORBIDDEN"],
			[403, "FORBIDDEN"],
			[403, "FORBIDDEN"],
		]);
		expect(await roleOf(id)).toBe("admin");
	});

	it("refuse a visitor without a session", async () => {
		expect((await send(bare(), "GET", "/api/members")).status).toBe(401);
	});
});

describe("the last administrator", () => {
	it("is never demoted or removed", async () => {
		const actor = await ownerId();
		const other = await addMember("admin");
		// Demoted meanwhile, as by `other` in another tab: `other` is now the only administrator.
		await db.update(users).set({ role: "viewer" }).where(eq(users.id, actor));

		await expect(setMemberRole(deps(), actor, other.id, "viewer")).rejects.toMatchObject({
			code: "LAST_ADMIN",
		});
		await expect(removeMember(deps(), actor, other.id)).rejects.toMatchObject({
			code: "LAST_ADMIN",
		});
		expect(await roleOf(other.id)).toBe("admin");
	});
});
