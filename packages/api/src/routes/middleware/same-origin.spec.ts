import type { Logger } from "../../lib/logger.ts";
import type { TestApp } from "../../testing/auth.ts";
import type { TempDatabase } from "../../testing/temp-database.ts";

import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { createLogger } from "../../lib/logger.ts";
import {
	ADMIN,
	TEST_ORIGIN,
	TEST_SETUP_TOKEN,
	buildTestApp,
	setUpAndSignIn,
	withSession,
} from "../../testing/auth.ts";
import { createTempDatabase } from "../../testing/temp-database.ts";
import { sameOrigin } from "./same-origin.ts";

/** The address a browser shows when `ARCHANT_URL` names another one. */
const FOREIGN = "http://127.0.0.1:5173";

/** One address for every request, so the setup limiter has one bucket. */
const PEER = "203.0.113.7";

const errorBody = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
const logLine = z.object({ level: z.number(), msg: z.string() }).catchall(z.unknown());

let temp: TempDatabase;
let logLines: string[];
let logger: Logger;
let app: TestApp;
let cookie: string;

/**
 * An app of its own: `withSession` rewrites `request` in place and adds the
 * trusted origin, so wrapping the shared `app` would give every later
 * no-origin test an `Origin` header.
 */
const signedIn = () =>
	withSession(buildTestApp(temp.db, logger, undefined, { peer: PEER }), cookie);

/** Every line logged since the last reset, parsed. */
const logged = () => logLines.map((line) => logLine.parse(JSON.parse(line)));
const warnings = () => logged().filter((line) => line.level === 40);

async function codeOf(response: Response) {
	return errorBody.parse(await response.json()).error.code;
}

const jsonPost = (path: string, body: unknown, origin?: string) =>
	app.request(path, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...(origin === undefined ? {} : { origin }),
		},
		body: JSON.stringify(body),
	});

beforeAll(async () => {
	temp = await createTempDatabase();
	logLines = [];
	logger = createLogger("info", { write: (line: string) => logLines.push(line) });
	app = buildTestApp(temp.db, logger, undefined, { peer: PEER });
});

beforeEach(() => {
	logLines.length = 0;
});

afterAll(async () => {
	await temp.dispose();
});

describe("setup from another origin", () => {
	it("leaves a read alone while setup is open", async () => {
		const response = await app.request("/api/setup", { headers: { origin: FOREIGN } });

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ data: { open: true } });
		expect(warnings()).toEqual([]);
	});

	it("refuses with ORIGIN_MISMATCH, creates no user and leaves the limiter untouched", async () => {
		// Four: one more than the setup limiter allows in ten seconds.
		const responses = await Promise.all(
			[1, 2, 3, 4].map(async () =>
				jsonPost("/api/setup", { ...ADMIN, token: TEST_SETUP_TOKEN }, FOREIGN),
			),
		);

		expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403]);
		expect(await codeOf(responses[0] ?? new Response())).toBe("ORIGIN_MISMATCH");
		await expect(temp.db.all(sql`select id from users`)).resolves.toEqual([]);
		expect(warnings()).toHaveLength(4);
		expect(warnings()[0]).toMatchObject({
			msg: "request from another origin refused",
			origin: FOREIGN,
			expected: TEST_ORIGIN,
		});

		// The limiter counted none of them: the right setup goes through.
		cookie = await setUpAndSignIn(app);
	});
});

describe("Better Auth from another origin", () => {
	it("refuses a sign-in in the envelope, sets no cookie, and logs one warning", async () => {
		const response = await jsonPost("/api/auth/sign-in/email", ADMIN, FOREIGN);

		expect(response.status).toBe(403);
		const body = errorBody.parse(await response.json());
		expect(body.error.code).toBe("ORIGIN_MISMATCH");
		// An unauthenticated caller learns nothing of the configuration.
		expect(JSON.stringify(body)).not.toContain(FOREIGN);
		expect(JSON.stringify(body)).not.toContain(TEST_ORIGIN);
		expect(response.headers.getSetCookie()).toEqual([]);
		// Nothing else from the request: Better Auth never ran.
		expect(logged()).toHaveLength(1);
		expect(warnings()).toEqual([
			expect.objectContaining({ origin: FOREIGN, expected: TEST_ORIGIN }),
		]);
	});

	it("lets a sign-in from the trusted origin through", async () => {
		const response = await jsonPost("/api/auth/sign-in/email", ADMIN, TEST_ORIGIN);

		expect(response.status).toBe(200);
		expect(warnings()).toEqual([]);
	});
});

async function createAccount() {
	const response = await signedIn().request("/api/accounts", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			name: "Compte joint",
			type: "depository",
			subtype: "checking",
			currency: "EUR",
			openingBalance: "0",
			openingDate: "2026-09-01",
		}),
	});
	const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(await response.json());

	return data.id;
}

function upload(accountId: string, origin: string) {
	const form = new FormData();
	form.append("file", new File(["OFXHEADER:100"], "releve.ofx"));

	return signedIn().request(`/api/accounts/${accountId}/imports`, {
		method: "POST",
		headers: { origin },
		body: form,
	});
}

describe("routes behind the session", () => {
	it("refuses an upload from another origin, and writes nothing", async () => {
		const accountId = await createAccount();
		logLines.length = 0;

		const response = await upload(accountId, FOREIGN);

		expect(response.status).toBe(403);
		expect(await codeOf(response)).toBe("ORIGIN_MISMATCH");
		await expect(temp.db.all(sql`select id from imports`)).resolves.toEqual([]);
		expect(warnings()).toHaveLength(1);
	});

	it("leaves a form post with a null origin to csrf()", async () => {
		const accountId = await createAccount();
		logLines.length = 0;

		const response = await upload(accountId, "null");

		expect(response.status).toBe(403);
		expect(await codeOf(response)).toBe("FORBIDDEN");
		expect(warnings()).toEqual([]);
	});

	it.each(["PUT", "PATCH", "DELETE"])("refuses a %s from another origin", async (method) => {
		const response = await signedIn().request("/api/accounts/unknown", {
			method,
			headers: { "content-type": "application/json", origin: FOREIGN },
			body: JSON.stringify({}),
		});

		expect(response.status).toBe(403);
		expect(await codeOf(response)).toBe("ORIGIN_MISMATCH");
	});

	it.each(["POST", "PUT", "PATCH", "DELETE"])(
		"lets a %s from the trusted origin reach its route",
		async (method) => {
			const response = await signedIn().request("/api/nope", {
				method,
				headers: { "content-type": "application/json", origin: TEST_ORIGIN },
				body: JSON.stringify({}),
			});

			expect(response.status).toBe(404);
			expect(warnings()).toEqual([]);
		},
	);
});

describe("a request with no origin", () => {
	it("leaves the scheduled sync to its secret", async () => {
		// As a cron's `curl -X POST` sends it: no origin, no body.
		const response = await app.request("/api/sync", { method: "POST" });

		expect(response.status).toBe(401);
		expect(await codeOf(response)).toBe("UNAUTHORIZED");
		expect(warnings()).toEqual([]);
	});

	it("leaves an in-process sign-in alone", async () => {
		const response = await jsonPost("/api/auth/sign-in/email", {
			email: ADMIN.email,
			password: "wrong password",
		});

		expect(response.status).toBe(401);
		expect(logged().map((line) => line.msg)).not.toContain("request from another origin refused");
	});
});

describe("the trusted origin", () => {
	it("is BETTER_AUTH_URL's origin, whatever path the URL carries", async () => {
		const guarded = new Hono()
			.use(sameOrigin({ trustedOrigin: "http://localhost:5173/", logger }))
			.post("/", (c) => c.text("reached"));

		const response = await guarded.request("/", {
			method: "POST",
			headers: { origin: "http://localhost:5173" },
		});

		expect(response.status).toBe(200);
		await expect(response.text()).resolves.toBe("reached");
		expect(warnings()).toEqual([]);
	});
});
