import type { SignedInTemplate, TestApp } from "../testing/auth.ts";
import type { TempDatabase } from "../testing/temp-database.ts";
import type { Auth } from "./auth.ts";

import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { twoFactors, users } from "@archant/data/schema/auth";

import { createLogger } from "../lib/logger.ts";
import {
	ADMIN,
	TEST_ORIGIN,
	buildTestApp,
	createSignedInTemplate,
	createTestAuth,
} from "../testing/auth.ts";
import { createTempDatabase } from "../testing/temp-database.ts";
import { resetPassword } from "./password.ts";

// Behind a trusted loopback proxy, so each request can name its own address:
// the plugin allows 3 requests per 10 seconds per address on each
// `/two-factor/*` path, and the fake clock below never lets 10 seconds pass.
const TRUSTED_PROXIES = ["127.0.0.1", "::1"];
const NETWORK = { peer: "::ffff:127.0.0.1", trustedProxies: TRUSTED_PROXIES };

let template: SignedInTemplate;
let temp: TempDatabase;
let addresses = 0;

// Every copy holds the administrator and a session: one sign-in for the file.
beforeAll(async () => {
	template = await createSignedInTemplate();
});

afterAll(async () => {
	await template.dispose();
});

beforeEach(async () => {
	// The clock stands still, so a TOTP code computed here is the one the
	// server expects, and a challenge can be aged on purpose.
	vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
	temp = await createTempDatabase(template.file);
});

afterEach(async () => {
	vi.useRealTimers();
	await temp.dispose();
});

type Server = { app: TestApp; auth: Auth };

function startServer(logger = createLogger("silent")): Server {
	const auth = createTestAuth(temp.db, logger, TRUSTED_PROXIES);

	return { app: buildTestApp(temp.db, logger, auth, NETWORK), auth };
}

/**
 * A browser's cookie jar, reduced to what these specs need: a cookie set
 * again replaces the old value, and one set with an empty value or
 * `Max-Age=0` is gone.
 */
class Jar {
	private readonly cookies = new Map<string, string>();

	constructor(header = "") {
		for (const pair of header.split("; ").filter((part) => part !== "")) {
			const separator = pair.indexOf("=");
			this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
		}
	}

	store(response: Response): void {
		for (const line of response.headers.getSetCookie()) {
			const [pair = ""] = line.split(";");
			const separator = pair.indexOf("=");
			const name = pair.slice(0, separator);
			const value = pair.slice(separator + 1);

			if (value === "" || /max-age=0(?:;|$)/iu.test(line)) {
				this.cookies.delete(name);
			} else {
				this.cookies.set(name, value);
			}
		}
	}

	has(suffix: string): boolean {
		return [...this.cookies.keys()].some((name) => name.endsWith(suffix));
	}

	get header(): string {
		return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
	}
}

/** A POST from its own address, carrying the jar's cookies and storing the answer's. */
async function post(app: TestApp, path: string, body: unknown, jar: Jar): Promise<Response> {
	addresses += 1;
	const response = await app.request(`/api/auth${path}`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			origin: TEST_ORIGIN,
			cookie: jar.header,
			"x-forwarded-for": `198.51.100.${addresses % 250}`,
		},
		body: JSON.stringify(body),
	});
	jar.store(response);

	return response;
}

/** Whether the jar holds a session the API accepts. */
async function isSignedIn(app: TestApp, jar: Jar): Promise<boolean> {
	const response = await app.request("/api/accounts", { headers: { cookie: jar.header } });

	return response.status === 200;
}

async function twoFactorEnabled(): Promise<boolean | null> {
	const [row] = await temp.db
		.select({ enabled: users.twoFactorEnabled })
		.from(users)
		.where(eq(users.email, ADMIN.email));

	return row?.enabled ?? null;
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * The secret an authenticator app reads from the URI, as the raw string
 * `generateTOTP` takes: the URI carries it in base32.
 */
function secretOf(totpURI: string): string {
	const encoded = new URL(totpURI).searchParams.get("secret") ?? "";
	const bits = encoded
		.split("")
		.map((char) => BASE32.indexOf(char).toString(2).padStart(5, "0"))
		.join("");
	const bytes = bits.match(/.{8}/gu) ?? [];

	return Buffer.from(bytes.map((byte) => Number.parseInt(byte, 2))).toString("latin1");
}

async function totp(auth: Auth, secret: string): Promise<string> {
	const { code } = await auth.api.generateTOTP({ body: { secret } });

	return code;
}

/** A code the server refuses: the right one, its last digit changed. */
function wrong(code: string): string {
	return `${code.slice(0, 5)}${(Number(code.at(5)) + 1) % 10}`;
}

type Enabled = { jar: Jar; secret: string; totpURI: string; backupCodes: string[] };

const enabledSchema = z.object({ totpURI: z.string(), backupCodes: z.array(z.string()) });
const enabledBody = (value: unknown) => enabledSchema.parse(value);

const backupCodesSchema = z.object({ backupCodes: z.array(z.string()) });
const backupCodesBody = (value: unknown) => backupCodesSchema.parse(value);

/** Turns two-factor on for the administrator, as the security page does. */
async function enable({ app, auth }: Server): Promise<Enabled> {
	const jar = new Jar(template.cookie);
	const started = await post(app, "/two-factor/enable", { password: ADMIN.password }, jar);
	const { totpURI, backupCodes } = enabledBody(await started.json());
	const secret = secretOf(totpURI);
	const verified = await post(
		app,
		"/two-factor/verify-totp",
		{ code: await totp(auth, secret) },
		jar,
	);

	expect(verified.status).toBe(200);

	return { jar, secret, totpURI, backupCodes };
}

/** The password step: a jar holding the challenge cookie, and the answer's body. */
async function passwordStep(app: TestApp, password: string = ADMIN.password) {
	const jar = new Jar();
	const response = await post(app, "/sign-in/email", { email: ADMIN.email, password }, jar);

	return {
		jar,
		status: response.status,
		body: z.record(z.string(), z.unknown()).parse(await response.json()),
	};
}

describe("turning two-factor on", () => {
	it("gives a URI and ten codes on the right password, and leaves it off until a code", async () => {
		const { app } = startServer();
		const jar = new Jar(template.cookie);

		const response = await post(app, "/two-factor/enable", { password: ADMIN.password }, jar);

		expect(response.status).toBe(200);
		const { totpURI, backupCodes } = enabledBody(await response.json());
		expect(totpURI).toMatch(/^otpauth:\/\/totp\/Archant:admin%40example\.test\?/u);
		expect(new URL(totpURI).searchParams.get("issuer")).toBe("Archant");
		expect(backupCodes).toHaveLength(10);
		expect(backupCodes.every((code) => /^[\dA-Za-z]{5}-[\dA-Za-z]{5}$/u.test(code))).toBe(true);
		await expect(twoFactorEnabled()).resolves.toBe(false);
		// Abandoned here, the next sign-in still has one step.
		const signIn = await passwordStep(app);
		expect(signIn.body).not.toHaveProperty("twoFactorRedirect");
		expect(await isSignedIn(app, signIn.jar)).toBe(true);
	});

	it("refuses a wrong password and writes nothing", async () => {
		const { app } = startServer();

		const response = await post(
			app,
			"/two-factor/enable",
			{ password: "pas le bon mot de passe" },
			new Jar(template.cookie),
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({ code: "INVALID_PASSWORD" });
		await expect(temp.db.select().from(twoFactors)).resolves.toEqual([]);
	});

	it("refuses a wrong code and stays off, then turns on with the right one", async () => {
		const server = startServer();
		const jar = new Jar(template.cookie);
		const started = await post(server.app, "/two-factor/enable", { password: ADMIN.password }, jar);
		const secret = secretOf(enabledBody(await started.json()).totpURI);
		const code = await totp(server.auth, secret);

		const refused = await post(server.app, "/two-factor/verify-totp", { code: wrong(code) }, jar);

		expect(refused.status).toBe(401);
		await expect(refused.json()).resolves.toMatchObject({ code: "INVALID_CODE" });
		await expect(twoFactorEnabled()).resolves.toBe(false);

		const accepted = await post(server.app, "/two-factor/verify-totp", { code }, jar);

		expect(accepted.status).toBe(200);
		await expect(twoFactorEnabled()).resolves.toBe(true);
		// Better Auth hands this browser a new session with the new user.
		expect(await isSignedIn(server.app, jar)).toBe(true);
	});
});

describe("signing in with two-factor on", () => {
	it("answers the password with a second step and no session", async () => {
		const server = startServer();
		await enable(server);

		const { jar, status, body } = await passwordStep(server.app);

		expect(status).toBe(200);
		expect(body).toMatchObject({ twoFactorRedirect: true, twoFactorMethods: ["totp"] });
		expect(jar.has("session_token")).toBe(false);
		expect(jar.has("two_factor")).toBe(true);
		expect(await isSignedIn(server.app, jar)).toBe(false);
	});

	it("signs in with a TOTP code, and not with a wrong one", async () => {
		const server = startServer();
		const { secret } = await enable(server);
		const { jar } = await passwordStep(server.app);
		const code = await totp(server.auth, secret);

		const refused = await post(server.app, "/two-factor/verify-totp", { code: wrong(code) }, jar);

		expect(refused.status).toBe(401);
		await expect(refused.json()).resolves.toMatchObject({ code: "INVALID_CODE" });
		expect(await isSignedIn(server.app, jar)).toBe(false);

		const accepted = await post(server.app, "/two-factor/verify-totp", { code }, jar);

		expect(accepted.status).toBe(200);
		expect(await isSignedIn(server.app, jar)).toBe(true);
	});

	it("signs in with a backup code once, and refuses the same code next time", async () => {
		const server = startServer();
		const { backupCodes } = await enable(server);
		const [code = ""] = backupCodes;

		const first = await passwordStep(server.app);
		const accepted = await post(server.app, "/two-factor/verify-backup-code", { code }, first.jar);

		expect(accepted.status).toBe(200);
		expect(await isSignedIn(server.app, first.jar)).toBe(true);

		const second = await passwordStep(server.app);
		const refused = await post(server.app, "/two-factor/verify-backup-code", { code }, second.jar);

		expect(refused.status).toBe(401);
		await expect(refused.json()).resolves.toMatchObject({ code: "INVALID_BACKUP_CODE" });
		expect(await isSignedIn(server.app, second.jar)).toBe(false);
	});

	it("ends the challenge after five wrong codes: the sixth attempt must sign in again", async () => {
		const server = startServer();
		const { secret } = await enable(server);
		const { jar } = await passwordStep(server.app);
		const code = await totp(server.auth, secret);

		// One after the other: each attempt reads the count the previous one wrote.
		const statuses = await Array.from({ length: 5 }).reduce<Promise<number[]>>(
			async (previous) => [
				...(await previous),
				(await post(server.app, "/two-factor/verify-totp", { code: wrong(code) }, jar)).status,
			],
			Promise.resolve([]),
		);

		// The right code, too late: the challenge is spent.
		const exhausted = await post(server.app, "/two-factor/verify-totp", { code }, jar);

		expect(statuses).toEqual([401, 401, 401, 401, 401]);
		expect(exhausted.status).toBe(400);
		await expect(exhausted.json()).resolves.toMatchObject({
			code: "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE",
		});
		expect(await isSignedIn(server.app, jar)).toBe(false);
	});

	it("ends the challenge after ten minutes", async () => {
		const server = startServer();
		const { secret } = await enable(server);
		const { jar } = await passwordStep(server.app);

		vi.setSystemTime(Date.now() + 10 * 60 * 1000 + 1000);
		const response = await post(
			server.app,
			"/two-factor/verify-totp",
			{ code: await totp(server.auth, secret) },
			// Replayed as sent: a browser would have dropped the expired cookie
			// and sent none, which the plugin refuses with the same code.
			new Jar(jar.header),
		);

		expect(response.status).toBe(401);
		await expect(response.json()).resolves.toMatchObject({ code: "INVALID_TWO_FACTOR_COOKIE" });
	});

	it("limits each /two-factor/ path to 3 requests per 10 seconds per address", async () => {
		const server = startServer();
		await enable(server);
		const { jar } = await passwordStep(server.app);
		const attempt = async () =>
			(
				await server.app.request("/api/auth/two-factor/verify-totp", {
					method: "POST",
					headers: {
						"content-type": "application/json",
						origin: TEST_ORIGIN,
						cookie: jar.header,
						"x-forwarded-for": "203.0.113.77",
					},
					body: JSON.stringify({ code: "000000" }),
				})
			).status;

		const statuses = [await attempt(), await attempt(), await attempt(), await attempt()];

		expect(statuses).toEqual([401, 401, 401, 429]);
	});
});

describe("turning two-factor off", () => {
	it("refuses a wrong password and stays on", async () => {
		const server = startServer();
		const { jar } = await enable(server);

		const response = await post(
			server.app,
			"/two-factor/disable",
			{ password: "pas le bon mot de passe" },
			jar,
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({ code: "INVALID_PASSWORD" });
		await expect(twoFactorEnabled()).resolves.toBe(true);
	});

	it("turns off on the password, and the next sign-in has one step", async () => {
		const server = startServer();
		const { jar } = await enable(server);

		const response = await post(
			server.app,
			"/two-factor/disable",
			{ password: ADMIN.password },
			jar,
		);

		expect(response.status).toBe(200);
		await expect(twoFactorEnabled()).resolves.toBe(false);
		await expect(temp.db.select().from(twoFactors)).resolves.toEqual([]);
		const signIn = await passwordStep(server.app);
		expect(signIn.body).not.toHaveProperty("twoFactorRedirect");
		expect(await isSignedIn(server.app, signIn.jar)).toBe(true);
	});
});

describe("regenerating backup codes", () => {
	it("refuses a wrong password and keeps the old codes", async () => {
		const server = startServer();
		const { jar, backupCodes } = await enable(server);

		const response = await post(
			server.app,
			"/two-factor/generate-backup-codes",
			{ password: "pas le bon mot de passe" },
			jar,
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({ code: "INVALID_PASSWORD" });
		const signIn = await passwordStep(server.app);
		const accepted = await post(
			server.app,
			"/two-factor/verify-backup-code",
			{ code: backupCodes[0] },
			signIn.jar,
		);
		expect(accepted.status).toBe(200);
	});

	it("replaces the ten codes: an old one is refused, a new one signs in", async () => {
		const server = startServer();
		const { jar, backupCodes } = await enable(server);

		const response = await post(
			server.app,
			"/two-factor/generate-backup-codes",
			{ password: ADMIN.password },
			jar,
		);

		expect(response.status).toBe(200);
		const fresh = backupCodesBody(await response.json()).backupCodes;
		expect(fresh).toHaveLength(10);
		expect(fresh.filter((code) => backupCodes.includes(code))).toEqual([]);

		const old = await passwordStep(server.app);
		const refused = await post(
			server.app,
			"/two-factor/verify-backup-code",
			{ code: backupCodes[0] },
			old.jar,
		);
		expect(refused.status).toBe(401);

		const renewed = await passwordStep(server.app);
		const accepted = await post(
			server.app,
			"/two-factor/verify-backup-code",
			{ code: fresh[0] },
			renewed.jar,
		);
		expect(accepted.status).toBe(200);
	});
});

describe("resetPassword and two-factor", () => {
	const NEW_PASSWORD = "un tout autre mot de passe";

	it("turns two-factor off, drops its secret and says so", async () => {
		const server = startServer();
		await enable(server);

		const result = await resetPassword({ auth: server.auth }, ADMIN.email, NEW_PASSWORD);

		expect(result.twoFactorDisabled).toBe(true);
		await expect(twoFactorEnabled()).resolves.toBe(false);
		await expect(temp.db.select().from(twoFactors)).resolves.toEqual([]);
		const signIn = await passwordStep(server.app, NEW_PASSWORD);
		expect(signIn.body).not.toHaveProperty("twoFactorRedirect");
		expect(await isSignedIn(server.app, signIn.jar)).toBe(true);
	});
});

describe("logs", () => {
	it("carry no secret, URI or code through the whole cycle", async () => {
		const lines: string[] = [];
		// `debug`, the most Better Auth and the request log ever write.
		const logger = createLogger("debug", { write: (line: string) => lines.push(line) });
		const server = startServer(logger);
		const { jar, secret, totpURI, backupCodes } = await enable(server);
		const code = await totp(server.auth, secret);

		const challenge = await passwordStep(server.app);
		await post(server.app, "/two-factor/verify-totp", { code: wrong(code) }, challenge.jar);
		await post(
			server.app,
			"/two-factor/verify-backup-code",
			{ code: backupCodes[1] },
			challenge.jar,
		);
		const regenerated = await post(
			server.app,
			"/two-factor/generate-backup-codes",
			{ password: ADMIN.password },
			jar,
		);
		const fresh = backupCodesBody(await regenerated.json()).backupCodes;
		await post(server.app, "/two-factor/disable", { password: ADMIN.password }, jar);

		const logged = lines.join("\n");
		const encodedSecret = new URL(totpURI).searchParams.get("secret") ?? "";
		for (const leak of [secret, encodedSecret, totpURI, ...backupCodes, ...fresh]) {
			expect(logged).not.toContain(leak);
		}

		// Six digits alone, not inside a longer number such as a timestamp.
		for (const digits of [code, wrong(code)]) {
			expect(logged).not.toMatch(new RegExp(`(?<!\\d)${digits}(?!\\d)`, "u"));
		}
	});
});
