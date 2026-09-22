import type { TempDatabase } from "../testing/temp-database.ts";

import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createLogger } from "../lib/logger.ts";
import { ADMIN, TEST_ORIGIN, buildTestApp, createTestAuth } from "../testing/auth.ts";
import { createTempDatabase } from "../testing/temp-database.ts";

const createdBody = z.object({ data: z.object({ id: z.string() }) });

let temp: TempDatabase | undefined;
let logLines: string[];

async function freshApp() {
	temp = await createTempDatabase();
	logLines = [];
	const logger = createLogger("info", { write: (line: string) => logLines.push(line) });
	const auth = createTestAuth(temp.db, logger);

	return { db: temp.db, auth, app: buildTestApp(temp.db, logger, auth) };
}

afterEach(async () => {
	vi.restoreAllMocks();
	await temp?.dispose();
	temp = undefined;
});

const postSetup = (app: ReturnType<typeof buildTestApp>, body: unknown) =>
	app.request("/api/setup", {
		method: "POST",
		headers: { "content-type": "application/json", origin: TEST_ORIGIN },
		body: JSON.stringify(body),
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
			{ email: "admin@example.test", name: "Admin", role: "admin" },
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
