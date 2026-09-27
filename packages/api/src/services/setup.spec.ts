import type { TestNetwork } from "../testing/auth.ts";
import type { TempDatabase } from "../testing/temp-database.ts";

import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createLogger } from "../lib/logger.ts";
import {
	ADMIN,
	TEST_ORIGIN,
	TEST_SETUP_TOKEN,
	buildTestApp,
	createTestAuth,
} from "../testing/auth.ts";
import { createTempDatabase } from "../testing/temp-database.ts";
import { completeSetup } from "./setup.ts";

const createdBody = z.object({ data: z.object({ id: z.string() }) });

let temp: TempDatabase | undefined;
let logLines: string[];

async function freshApp(network: TestNetwork = {}) {
	temp = await createTempDatabase();
	logLines = [];
	const logger = createLogger("info", { write: (line: string) => logLines.push(line) });
	const auth = createTestAuth(temp.db, logger, network.trustedProxies);

	return { db: temp.db, auth, logger, app: buildTestApp(temp.db, logger, auth, network) };
}

afterEach(async () => {
	vi.restoreAllMocks();
	await temp?.dispose();
	temp = undefined;
});

/** Posts `body`, with the test app's setup token unless `body` names its own. */
const postSetup = (
	app: ReturnType<typeof buildTestApp>,
	body: Record<string, unknown>,
	headers: Record<string, string> = {},
) => postRaw(app, JSON.stringify({ token: TEST_SETUP_TOKEN, ...body }), headers);

const postRaw = (
	app: ReturnType<typeof buildTestApp>,
	body: string,
	headers: Record<string, string> = {},
) =>
	app.request("/api/setup", {
		method: "POST",
		headers: { "content-type": "application/json", origin: TEST_ORIGIN, ...headers },
		body,
	});

async function usersOf(db: TempDatabase["db"]) {
	return db.all<{ email: string; name: string; role: string }>(
		sql`select email, name, role from users`,
	);
}

async function setupRowsOf(db: TempDatabase["db"]) {
	return db.all<{ key: string }>(sql`select key from settings where key = 'setup_completed_at'`);
}

describe("GET /api/setup", () => {
	it("is open while no user exists", async () => {
		const { app } = await freshApp();

		const response = await app.request("/api/setup");

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ data: { open: true } });
	});
});

describe("POST /api/setup", () => {
	it("creates the single administrator and closes setup", async () => {
		const { app, db } = await freshApp();

		const response = await postSetup(app, { ...ADMIN, email: " Admin@Example.test " });

		expect(response.status).toBe(201);
		const { data } = createdBody.parse(await response.json());
		await expect(usersOf(db)).resolves.toEqual([
			{ email: "admin@example.test", name: "", role: "admin" },
		]);
		await expect(setupRowsOf(db)).resolves.toHaveLength(1);
		const closed = await app.request("/api/setup");
		expect(closed.status).toBe(403);
		await expect(closed.json()).resolves.toMatchObject({ error: { code: "FORBIDDEN" } });
		// The user id only: never the email or the password.
		const logs = logLines.join("\n");
		expect(logs).toContain(data.id);
		expect(logs).not.toMatch(/admin@example|correct horse/iu);
	});

	it.each([
		[undefined, ""],
		["  ", ""],
		[" Camille ", "Camille"],
		["x".repeat(60), "x".repeat(60)],
	])("stores the first name %j as %j", async (name, stored) => {
		const { app, db } = await freshApp();

		const response = await postSetup(app, { ...ADMIN, ...(name === undefined ? {} : { name }) });

		expect(response.status).toBe(201);
		await expect(usersOf(db)).resolves.toMatchObject([{ name: stored }]);
	});

	it.each([
		["a wrong token", "not-the-setup-token"],
		["an empty token", ""],
		["a blank token", "   "],
		["a token with one character more", `${TEST_SETUP_TOKEN}x`],
	])("refuses %s with SETUP_TOKEN_INVALID and writes nothing", async (_name, token) => {
		const { app, db } = await freshApp();

		const response = await postSetup(app, { ...ADMIN, token });

		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toEqual({
			error: { code: "SETUP_TOKEN_INVALID", message: "The setup token is invalid." },
		});
		await expect(usersOf(db)).resolves.toEqual([]);
		await expect(setupRowsOf(db)).resolves.toEqual([]);
		expect((await app.request("/api/setup")).status).toBe(200);
	});

	it("logs a refused token without the value submitted", async () => {
		const { app } = await freshApp();

		await postSetup(app, { ...ADMIN, token: "guessed-token-value" });

		const logs = logLines.join("\n");
		expect(logs).toContain("setup refused");
		expect(logs).not.toContain("guessed-token-value");
		expect(logs).not.toContain(TEST_SETUP_TOKEN);
	});

	it("refuses every token when the server generated none", async () => {
		const { auth, db, logger } = await freshApp();

		await expect(
			completeSetup({ db, auth, logger, setupToken: null }, { ...ADMIN, token: "" }),
		).rejects.toMatchObject({ code: "SETUP_TOKEN_INVALID" });
		await expect(usersOf(db)).resolves.toEqual([]);
		await expect(setupRowsOf(db)).resolves.toEqual([]);
	});

	it("answers the field error to the right token with a bad email", async () => {
		const { app } = await freshApp();

		const response = await postSetup(app, { ...ADMIN, email: "admin" });

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			error: { code: "VALIDATION_ERROR", fields: [{ path: "email", code: "invalid_email" }] },
		});
	});

	it("answers TOO_MANY_REQUESTS to a fourth attempt in ten seconds, before reading the body", async () => {
		const { app, db } = await freshApp({ peer: "203.0.113.7" });

		const attempts = await Promise.all(
			["guess-0", "guess-1", "guess-2"].map(async (token) => postSetup(app, { ...ADMIN, token })),
		);
		const statuses = attempts.map((response) => response.status);

		const fourth = await postRaw(app, "not json");

		expect(statuses).toEqual([403, 403, 403]);
		expect(fourth.status).toBe(429);
		await expect(fourth.json()).resolves.toMatchObject({ error: { code: "TOO_MANY_REQUESTS" } });
		// The right token is refused too until the window ends.
		expect((await postSetup(app, ADMIN)).status).toBe(429);
		await expect(usersOf(db)).resolves.toEqual([]);
	});

	it("ignores a forged x-forwarded-for when no proxy is trusted", async () => {
		const { app } = await freshApp({ peer: "203.0.113.7" });
		const wrongSetup = async (address: string) =>
			(await postSetup(app, { ...ADMIN, token: "wrong" }, { "x-forwarded-for": address })).status;

		const statuses = [
			await wrongSetup("198.51.100.1"),
			await wrongSetup("198.51.100.2"),
			await wrongSetup("198.51.100.3"),
			await wrongSetup("198.51.100.4"),
		];

		expect(statuses).toEqual([403, 403, 403, 429]);
	});

	it("counts each address behind a trusted proxy on its own", async () => {
		const { app } = await freshApp({ peer: "127.0.0.1", trustedProxies: ["127.0.0.1"] });

		const addresses = ["203.0.113.7", "198.51.100.1"].flatMap((address) => [
			address,
			address,
			address,
		]);
		const attempts = await Promise.all(
			addresses.map(async (address) =>
				postSetup(app, { ...ADMIN, token: "wrong" }, { "x-forwarded-for": address }),
			),
		);
		const statuses = attempts.map((response) => response.status);

		expect(statuses).toEqual([403, 403, 403, 403, 403, 403]);
		expect((await postSetup(app, ADMIN, { "x-forwarded-for": "192.0.2.1" })).status).toBe(201);
	});

	it.each([
		["a valid body", JSON.stringify({ ...ADMIN, token: TEST_SETUP_TOKEN })],
		["an invalid body", JSON.stringify({ email: "x" })],
		["a body that is not JSON", "not json"],
	])("answers FORBIDDEN to %s once a user exists", async (_name, body) => {
		const { app } = await freshApp();
		await postSetup(app, ADMIN);

		const response = await postRaw(app, body);

		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toMatchObject({ error: { code: "FORBIDDEN" } });
	});

	it("answers FORBIDDEN once a user exists, and writes nothing", async () => {
		const { app, db } = await freshApp();
		await postSetup(app, ADMIN);

		const response = await postSetup(app, { email: "other@example.test", password: "12345678" });

		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toMatchObject({ error: { code: "FORBIDDEN" } });
		await expect(usersOf(db)).resolves.toHaveLength(1);
	});

	it("lets one of two concurrent setups through", async () => {
		const { app, db } = await freshApp();

		const responses = await Promise.all([
			postSetup(app, ADMIN),
			postSetup(app, { email: "other@example.test", password: "12345678" }),
		]);

		expect(responses.map((response) => response.status).toSorted((a, b) => a - b)).toEqual([
			201, 403,
		]);
		await expect(usersOf(db)).resolves.toHaveLength(1);
		await expect(setupRowsOf(db)).resolves.toHaveLength(1);
	});

	it.each([
		[{ ...ADMIN, password: "1234567" }, "password", "password_too_short"],
		[{ ...ADMIN, password: "x".repeat(129) }, "password", "password_too_long"],
		[{ ...ADMIN, email: "admin" }, "email", "invalid_email"],
		[{ ...ADMIN, email: " " }, "email", "too_small"],
		[{ ...ADMIN, name: "x".repeat(61) }, "name", "too_big"],
	])("refuses %j with its field code and writes nothing", async (body, path, code) => {
		const { app, db } = await freshApp();

		const response = await postSetup(app, body);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "VALIDATION_ERROR",
				message: "The request is invalid.",
				fields: [{ path, code }],
			},
		});
		await expect(usersOf(db)).resolves.toEqual([]);
		await expect(setupRowsOf(db)).resolves.toEqual([]);
	});

	it("accepts a password of exactly 8 and of 128 characters", async () => {
		const { app } = await freshApp();

		await expect(postSetup(app, { ...ADMIN, password: "12345678" })).resolves.toMatchObject({
			status: 201,
		});
		await temp?.dispose();

		const again = await freshApp();

		await expect(
			postSetup(again.app, { ...ADMIN, password: "x".repeat(128) }),
		).resolves.toMatchObject({ status: 201 });
	});

	it("releases the claim when creating the user fails, so setup can be retried", async () => {
		const { app, auth, db } = await freshApp();
		vi.spyOn(auth.api, "createUser").mockRejectedValueOnce(new Error("SQLITE_BUSY"));

		const failed = await postSetup(app, ADMIN);

		expect(failed.status).toBe(500);
		await expect(failed.json()).resolves.toMatchObject({ error: { code: "INTERNAL_ERROR" } });
		await expect(setupRowsOf(db)).resolves.toEqual([]);
		await expect(usersOf(db)).resolves.toEqual([]);
		expect((await app.request("/api/setup")).status).toBe(200);

		await expect(postSetup(app, ADMIN)).resolves.toMatchObject({ status: 201 });
		await expect(usersOf(db)).resolves.toHaveLength(1);
	});
});
