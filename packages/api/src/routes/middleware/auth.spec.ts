import type { TestApp } from "../../testing/auth.ts";
import type { TempDatabase } from "../../testing/temp-database.ts";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
	ADMIN,
	TEST_ORIGIN,
	buildTestApp,
	setUpAndSignIn,
	signIn,
	withSession,
} from "../../testing/auth.ts";
import { createTempDatabase } from "../../testing/temp-database.ts";
import { isPublicPath } from "./auth.ts";

let temp: TempDatabase;
let cookie: string;

const anonymous = (): TestApp => buildTestApp(temp.db);
const signedIn = (): TestApp => withSession(buildTestApp(temp.db), cookie);

beforeAll(async () => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-09-21T10:00:00Z"));
	temp = await createTempDatabase();
	cookie = await setUpAndSignIn(anonymous());
});

afterAll(async () => {
	vi.useRealTimers();
	await temp.dispose();
});

describe("isPublicPath", () => {
	it.each([
		["/api/auth/sign-in/email", true],
		["/api/auth", true],
		["/api/setup", true],
		["/api/health", true],
		["/api/sync", true],
		["/api/authx", false],
		["/api/setup/other", false],
		["/api/accounts", false],
		["/api/sync/other", false],
	])("%s is public: %s", (path, expected) => {
		expect(isPublicPath(path)).toBe(expected);
	});
});

describe("the session guard", () => {
	it.each(["/api/accounts", "/api/transactions", "/api/nope"])(
		"answers UNAUTHORIZED on %s without a session",
		async (path) => {
			const response = await anonymous().request(path);

			expect(response.status).toBe(401);
			await expect(response.json()).resolves.toEqual({
				error: { code: "UNAUTHORIZED", message: "Sign in to continue." },
			});
		},
	);

	it("answers UNAUTHORIZED for a forged session cookie", async () => {
		const response = await anonymous().request("/api/accounts", {
			headers: { cookie: "better-auth.session_token=forged.signature" },
		});

		expect(response.status).toBe(401);
	});

	it("lets a signed-in request through, and an unknown route answers NOT_FOUND then", async () => {
		const app = signedIn();

		expect((await app.request("/api/accounts")).status).toBe(200);
		expect((await app.request("/api/nope")).status).toBe(404);
	});

	it("leaves setup and Better Auth's own routes reachable without a session", async () => {
		const setup = await anonymous().request("/api/setup");
		const session = await anonymous().request("/api/auth/get-session");

		expect(setup.status).toBe(403);
		expect(session.status).toBe(200);
		await expect(session.json()).resolves.toBeNull();
	});
});

describe("roles", () => {
	it("refuses a role change through Better Auth's update endpoint", async () => {
		const response = await signedIn().request("/api/auth/update-user", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ role: "viewer" }),
		});

		expect(response.status).toBe(400);
		await expect(temp.db.all(sql`select role from users`)).resolves.toEqual([{ role: "admin" }]);
	});
});

/** Better Auth's own profile update, as the security page sends it. */
const updateUser = (body: unknown) =>
	signedIn().request("/api/auth/update-user", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});

async function storedName() {
	const rows = await temp.db.all<{ name: string }>(sql`select name from users`);

	return rows.map((row) => row.name);
}

describe("the first name", () => {
	it("stores a trimmed name, then clears it", async () => {
		expect((await updateUser({ name: " Camille " })).status).toBe(200);
		await expect(storedName()).resolves.toEqual(["Camille"]);

		expect((await updateUser({ name: "   " })).status).toBe(200);
		await expect(storedName()).resolves.toEqual([""]);
	});

	it("refuses a name of 61 characters, and keeps the stored one", async () => {
		await updateUser({ name: "Camille" });

		const response = await updateUser({ name: "x".repeat(61) });

		expect(response.status).toBe(400);
		await expect(storedName()).resolves.toEqual(["Camille"]);
	});
});

describe("Better Auth's endpoints", () => {
	it("refuses a public sign-up, and creates no user", async () => {
		const response = await anonymous().request("/api/auth/sign-up/email", {
			method: "POST",
			headers: { "content-type": "application/json", origin: TEST_ORIGIN },
			body: JSON.stringify({ email: "stranger@example.test", password: "12345678", name: "S" }),
		});

		expect(response.status).toBe(400);
		await expect(temp.db.all(sql`select email from users`)).resolves.toEqual([
			{ email: ADMIN.email },
		]);
	});

	it("does not serve the admin plugin's routes, even to the admin", async () => {
		const response = await signedIn().request("/api/auth/admin/set-role", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ userId: "x", role: "user" }),
		});

		expect(response.status).toBe(404);
	});
});

describe("cross-site form posts", () => {
	it("refuses an upload from a foreign origin, and writes nothing", async () => {
		const created = await signedIn().request("/api/accounts", {
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
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(await created.json());
		const form = new FormData();
		form.append("file", new File(["OFXHEADER:100"], "releve.ofx"));

		const response = await signedIn().request(`/api/accounts/${data.id}/imports`, {
			method: "POST",
			headers: { origin: "https://attacker.example" },
			body: form,
		});

		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toMatchObject({ error: { code: "FORBIDDEN" } });
		await expect(temp.db.all(sql`select id from imports`)).resolves.toEqual([]);
	});
});

describe("sign-in rate limit", () => {
	it("refuses a fourth attempt within ten seconds", async () => {
		// Past the window of the sign-in beforeAll made.
		vi.setSystemTime(new Date("2026-09-21T10:01:00Z"));
		const app = anonymous();
		const wrong = { email: ADMIN.email, password: "wrong password" };

		// One after the other: the limit counts attempts in the order they land.
		const statuses = [
			(await signIn(app, wrong)).status,
			(await signIn(app, wrong)).status,
			(await signIn(app, wrong)).status,
			(await signIn(app, wrong)).status,
		];

		expect(statuses).toEqual([401, 401, 401, 429]);
		// Even the right password waits for the window to pass.
		expect((await signIn(app, ADMIN)).status).toBe(429);

		vi.setSystemTime(new Date("2026-09-21T10:01:11Z"));

		expect((await signIn(app, ADMIN)).status).toBe(200);
	});
});

/** A wrong sign-in as sent by `forwardedFor`'s client, over `app`'s TCP peer. */
async function wrongSignIn(app: TestApp, forwardedFor: string) {
	const response = await app.request("/api/auth/sign-in/email", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			origin: TEST_ORIGIN,
			"x-forwarded-for": forwardedFor,
		},
		body: JSON.stringify({ email: ADMIN.email, password: "wrong password" }),
	});

	return response.status;
}

describe("client address", () => {
	it("ignores a forged x-forwarded-for when no proxy is trusted", async () => {
		const app = buildTestApp(temp.db, undefined, undefined, { peer: "203.0.113.7" });

		const statuses = [
			await wrongSignIn(app, "198.51.100.1"),
			await wrongSignIn(app, "198.51.100.2"),
			await wrongSignIn(app, "198.51.100.3"),
			await wrongSignIn(app, "198.51.100.4"),
		];

		expect(statuses).toEqual([401, 401, 401, 429]);
	});

	it("gives each client behind a trusted proxy its own bucket", async () => {
		// Node reports a loopback IPv4 peer on a dual-stack socket in this form.
		const app = buildTestApp(temp.db, undefined, undefined, {
			peer: "::ffff:127.0.0.1",
			trustedProxies: ["127.0.0.1", "::1"],
		});

		const first = [
			await wrongSignIn(app, "198.51.100.10"),
			await wrongSignIn(app, "198.51.100.10"),
			await wrongSignIn(app, "198.51.100.10"),
			await wrongSignIn(app, "198.51.100.10"),
		];

		expect(first).toEqual([401, 401, 401, 429]);
		expect(await wrongSignIn(app, "198.51.100.11")).toBe(401);
	});
});

describe("session refresh", () => {
	it("forwards the cookie Better Auth re-sends once the session is a day old", async () => {
		vi.setSystemTime(new Date("2026-09-22T11:00:00Z"));

		const response = await signedIn().request("/api/accounts");

		expect(response.status).toBe(200);
		expect(response.headers.getSetCookie().join("\n")).toMatch(/^better-auth\.session_token=/mu);
	});
});
