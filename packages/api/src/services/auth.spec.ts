import type { SignedInTemplate, TestApp } from "../testing/auth.ts";
import type { TempDatabase } from "../testing/temp-database.ts";
import type { Auth } from "./auth.ts";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { rateLimits, signInFailures } from "@archant/data/schema/auth";

import { createLogger } from "../lib/logger.ts";
import {
	ADMIN,
	TEST_ORIGIN,
	buildTestApp,
	createSignedInTemplate,
	createTestAuth,
} from "../testing/auth.ts";
import { createTempDatabase } from "../testing/temp-database.ts";
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
