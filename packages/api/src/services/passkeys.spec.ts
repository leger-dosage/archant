import type { TempDatabase } from "../testing/temp-database.ts";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { passkeys, twoFactors } from "@archant/data/schema/auth";

import { createLogger } from "../lib/logger.ts";
import { TEST_ORIGIN, TEST_SECRET } from "../testing/auth.ts";
import { createTempDatabase } from "../testing/temp-database.ts";
import { createAuth } from "./auth.ts";
import { resetPassword } from "./password.ts";

let database: TempDatabase;

beforeAll(async () => {
	database = await createTempDatabase();
});

afterAll(async () => {
	await database?.dispose();
});

function auth(mode: boolean) {
	return createAuth({
		db: database.db,
		baseURL: TEST_ORIGIN,
		secret: TEST_SECRET,
		trustedProxies: [],
		logger: createLogger("silent"),
		passkeyLoginEnabled: mode,
	});
}

function post(server: ReturnType<typeof auth>, path: string, body: object, cookie = "") {
	return server.handler(
		new Request(`${TEST_ORIGIN}/api/auth/${path}`, {
			method: "POST",
			headers: { origin: TEST_ORIGIN, "content-type": "application/json", cookie },
			body: JSON.stringify(body),
		}),
	);
}

describe("passkey entry points", () => {
	it("asks for user verification and allows discovery in standalone mode", async () => {
		const response = await post(auth(true), "passkey/sign-in-options", { mode: "standalone" });
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			rpId: "localhost",
			userVerification: "required",
		});
	});

	it("refuses standalone sign-in when disabled and second factor without a pending sign-in", async () => {
		const server = auth(false);
		expect((await post(server, "passkey/sign-in-options", { mode: "standalone" })).status).toBe(
			403,
		);
		expect((await post(server, "passkey/sign-in-options", { mode: "second-factor" })).status).toBe(
			401,
		);
	});

	it("refuses registration without a session and closes the unguarded plugin entry points", async () => {
		const server = auth(true);
		expect(
			(await post(server, "passkey/registration-options", { name: "Test key", code: "123456" }))
				.status,
		).toBe(401);
		expect((await post(server, "passkey/verify-authentication", { response: {} })).status).toBe(
			404,
		);
		expect((await post(server, "passkey/verify-registration", { response: {} })).status).toBe(404);
	});
	it("binds the passkey challenge to the password attempt that requested it", async () => {
		const server = auth(false);
		const owner = await enrolledMember(server, "owner");
		const other = await enrolledMember(server, "other");
		const [ownerAttempt, otherAttempt] = await Promise.all([
			post(server, "sign-in/email", owner.credentials),
			post(server, "sign-in/email", other.credentials),
		]);
		expect(ownerAttempt.status).toBe(200);
		expect(otherAttempt.status).toBe(200);
		const ownerCookie = findCookie(ownerAttempt, "two_factor");
		const otherCookie = findCookie(otherAttempt, "two_factor");
		const options = await post(
			server,
			"passkey/sign-in-options",
			{ mode: "second-factor" },
			ownerCookie,
		);
		expect(options.status).toBe(200);
		const challenge = findCookie(options, "passkey-second-factor");
		const answer = await post(
			server,
			"passkey/sign-in",
			{
				mode: "second-factor",
				response: {
					id: "unused",
					rawId: "unused",
					type: "public-key",
					clientExtensionResults: {},
					response: { clientDataJSON: "unused", authenticatorData: "unused", signature: "unused" },
				},
			},
			`${challenge}; ${otherCookie}`,
		);
		expect(answer.status).toBe(401);
		expect(await answer.json()).toMatchObject({ code: "INVALID_TWO_FACTOR_COOKIE" });
		expect(answer.headers.get("set-cookie")).not.toContain("session_token=");
	});

	it("the terminal password reset removes the enrolled keys", async () => {
		const server = auth(true);
		const member = await enrolledMember(server, "recovery");
		await expect(
			resetPassword({ auth: server }, member.credentials.email, "a different password"),
		).resolves.toMatchObject({ twoFactorDisabled: true });
		const remaining = await database.db.select({ userId: passkeys.userId }).from(passkeys);
		expect(remaining).not.toContainEqual({ userId: member.id });
	});
});

const PASSWORD = "synthetic password for passkey tests";

async function enrolledMember(server: ReturnType<typeof auth>, name: string) {
	const credentials = { email: `${name}@example.test`, password: PASSWORD };
	const { user } = await server.api.createUser({ body: { ...credentials, name } });
	const context = await server.$context;
	await context.internalAdapter.updateUser(user.id, { twoFactorEnabled: true });
	await database.db.insert(twoFactors).values({
		id: name,
		userId: user.id,
		secret: "unused",
		backupCodes: "unused",
		verified: true,
	});
	await database.db.insert(passkeys).values({
		id: name,
		userId: user.id,
		factorId: name,
		credentialID: name,
		userHandle: name,
		publicKey: "unused",
		deviceType: "singleDevice",
		counter: 0,
		backedUp: false,
	});

	return { id: user.id, credentials };
}

function findCookie(response: Response, name: string): string {
	const cookie = response.headers.getSetCookie().find((entry) => entry.includes(`.${name}=`));
	expect(cookie).toBeDefined();

	return cookie?.split(";", 1)[0] ?? "";
}
