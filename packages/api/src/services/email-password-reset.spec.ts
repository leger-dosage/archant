import type { TempDatabase } from "../testing/temp-database.ts";

import { base32 } from "@better-auth/utils/base32";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";

import { createLogger } from "../lib/logger.ts";
import {
	ADMIN,
	TEST_ORIGIN,
	TEST_SECRET,
	buildTestApp,
	cookieOf,
	setUpAndSignIn,
	signIn,
} from "../testing/auth.ts";
import { createTempDatabase } from "../testing/temp-database.ts";
import { createAuth } from "./auth.ts";

const NEW_PASSWORD = "a new password for this test";
let temp: TempDatabase | undefined;

async function setup({ mail = true } = {}) {
	temp = await createTempDatabase();
	const links: URL[] = [];
	const logs: string[] = [];
	const logger = createLogger("debug", { write: (line: string) => logs.push(line) });
	const auth = createAuth({
		db: temp.db,
		secret: TEST_SECRET,
		baseURL: TEST_ORIGIN,
		trustedProxies: [],
		logger,
		...(mail
			? { sendPasswordReset: async (_email: string, url: URL) => void links.push(url) }
			: {}),
	});
	const app = buildTestApp(temp.db, logger, auth, { peer: "203.0.113.15" });
	const cookie = await setUpAndSignIn(app);
	const post = (path: string, body: Record<string, string>, sessionCookie?: string) =>
		app.request(`/api/auth/${path}`, {
			method: "POST",
			headers: {
				origin: TEST_ORIGIN,
				"content-type": "application/json",
				...(sessionCookie ? { cookie: sessionCookie } : {}),
			},
			body: JSON.stringify(body),
		});
	const requestReset = (email: string = ADMIN.email) => post("request-password-reset", { email });
	const redeem = (token: string) => post("reset-password", { token, newPassword: NEW_PASSWORD });
	const check = (token: string) => post("check-password-reset", { token });
	const tokenAt = (index: number) =>
		new URLSearchParams(links[index]?.hash.slice(1)).get("token") ?? "";

	return { app, auth, cookie, post, links, logs, requestReset, redeem, check, tokenAt };
}

afterEach(async () => {
	vi.useRealTimers();
	await temp?.dispose();
	temp = undefined;
});

it("disables password recovery without mail configuration", async () => {
	const { app, requestReset, redeem } = await setup({ mail: false });
	const options = await app.request("/api/password-reset");
	expect(options.status).toBe(200);
	await expect(options.json()).resolves.toEqual({ data: { enabled: false } });
	expect((await requestReset()).status).toBe(404);
	expect((await redeem("inactive")).status).toBe(404);
});

it("answers alike for local, unknown and passwordless users, and limits requests", async () => {
	const { app, auth, links, logs, requestReset, tokenAt } = await setup();
	const options = await app.request("/api/password-reset");
	await expect(options.json()).resolves.toEqual({ data: { enabled: true } });
	const ssoEmail = "sso@example.test";
	await auth.api.createUser({ body: { email: ssoEmail, name: "SSO" } });

	const known = await requestReset();
	const unknown = await requestReset("unknown@example.test");
	const sso = await requestReset(ssoEmail);
	expect([known.status, unknown.status, sso.status]).toEqual([200, 200, 200]);
	const reply: unknown = await known.json();
	await expect(unknown.json()).resolves.toEqual(reply);
	await expect(sso.json()).resolves.toEqual(reply);
	expect(links.length).toBe(1);
	expect(links[0]?.origin).toBe(TEST_ORIGIN);
	expect(links[0]?.pathname).toBe("/reset-password");
	expect(links[0]?.search === "").toBe(true);
	expect(tokenAt(0).length > 0).toBe(true);
	expect(logs.join("").includes(tokenAt(0))).toBe(false);
	expect((await requestReset()).status).toBe(429);
});

it("expires links after fifteen minutes", async () => {
	vi.useFakeTimers({ toFake: ["Date"] });
	const { requestReset, redeem, check, tokenAt } = await setup();
	expect((await requestReset()).status).toBe(200);
	const token = tokenAt(0);
	vi.setSystemTime(Date.now() + 15 * 60_000 + 1);
	expect((await check(token)).status).toBe(400);
	expect((await redeem(token)).status).toBe(400);
});

it("revokes the sessions and every pending link without turning off two-factor", async () => {
	const { app, auth, cookie, post, requestReset, redeem, check, tokenAt } = await setup();
	const { internalAdapter } = await auth.$context;
	const user = await internalAdapter.findUserByEmail(ADMIN.email);
	expect(user).not.toBeNull();
	if (user === null) {
		throw new Error("Missing test user");
	}
	const enrollment = await post("two-factor/enable", { password: ADMIN.password }, cookie);
	expect(enrollment.status).toBe(200);
	const { totpURI, backupCodes } = z
		.object({
			totpURI: z.string(),
			backupCodes: z.tuple([z.string()]).rest(z.string()),
		})
		.parse(await enrollment.json());
	const secret = new TextDecoder().decode(
		base32.decode(new URL(totpURI).searchParams.get("secret") ?? ""),
	);
	const { code } = await auth.api.generateTOTP({ body: { secret } });
	const activation = await post("two-factor/verify-totp", { code }, cookie);
	expect(activation.status).toBe(200);
	const activeSession = cookieOf(activation);
	expect((await app.request("/api/accounts", { headers: { cookie: activeSession } })).status).toBe(
		200,
	);
	await internalAdapter.createVerificationValue({
		identifier: "trust-device-test",
		value: user.user.id,
		expiresAt: new Date(Date.now() + 60_000),
	});

	expect((await requestReset()).status).toBe(200);
	expect((await requestReset()).status).toBe(200);
	expect((await check(tokenAt(1))).status).toBe(200);
	expect((await redeem(tokenAt(1))).status).toBe(200);
	expect((await redeem(tokenAt(1))).status).toBe(400);
	expect((await check(tokenAt(0))).status).toBe(400);
	expect((await redeem(tokenAt(0))).status).toBe(400);
	expect(await internalAdapter.findVerificationValue("trust-device-test")).toBeNull();
	expect((await app.request("/api/accounts", { headers: { cookie: activeSession } })).status).toBe(
		401,
	);
	expect((await signIn(app, ADMIN)).status).toBe(401);
	const signInResponse = await signIn(app, { email: ADMIN.email, password: NEW_PASSWORD });
	expect(signInResponse.status).toBe(200);
	await expect(signInResponse.json()).resolves.toMatchObject({ twoFactorRedirect: true });
	const secondFactor = await post(
		"two-factor/verify-backup-code",
		{ code: backupCodes[0] },
		cookieOf(signInResponse),
	);
	expect(secondFactor.status).toBe(200);
});

it("accepts only one redemption when two links are used at the same time", async () => {
	const { requestReset, redeem, tokenAt } = await setup();
	expect((await requestReset()).status).toBe(200);
	expect((await requestReset()).status).toBe(200);

	const responses = await Promise.all([redeem(tokenAt(0)), redeem(tokenAt(1))]);
	expect(responses.map(({ status }) => status).toSorted((left, right) => left - right)).toEqual([
		200, 400,
	]);
});
