import type { TempDatabase } from "../testing/temp-database.ts";

import { afterEach, describe, expect, it } from "vitest";

import {
	ADMIN,
	TEST_ORIGIN,
	buildTestApp,
	createTestAuth,
	setUpAndSignIn,
	signIn,
} from "../testing/auth.ts";
import { createTempDatabase } from "../testing/temp-database.ts";
import { PasswordResetError, resetPassword } from "./password.ts";

const NEW_PASSWORD = "un tout autre mot de passe";

let temp: TempDatabase | undefined;
let peers = 0;

/**
 * Each test gets its own client address: Better Auth's memory rate limiter is
 * shared by every instance in the process, and its sign-in rule allows three
 * attempts per ten seconds for one address.
 */
async function signedInApp() {
	temp = await createTempDatabase();
	peers += 1;
	const auth = createTestAuth(temp.db);
	const app = buildTestApp(temp.db, undefined, auth, { peer: `203.0.113.${peers}` });
	const cookie = await setUpAndSignIn(app);

	return { app, auth, cookie };
}

/** What the API answers this cookie, the only way to see whether a session survived. */
function accountsWith(app: ReturnType<typeof buildTestApp>, cookie: string) {
	return app.request("/api/accounts", { headers: { cookie } });
}

afterEach(async () => {
	await temp?.dispose();
	temp = undefined;
});

describe("resetPassword", () => {
	it("sets the new password, refuses the old one and revokes every session", async () => {
		const { app, auth, cookie } = await signedInApp();
		expect((await accountsWith(app, cookie)).status).toBe(200);

		const { userId } = await resetPassword({ auth }, ADMIN.email, NEW_PASSWORD);

		expect(userId).not.toBe("");
		const revoked = await accountsWith(app, cookie);
		expect(revoked.status).toBe(401);
		await expect(revoked.json()).resolves.toMatchObject({ error: { code: "UNAUTHORIZED" } });
		await expect(
			signIn(app, { email: ADMIN.email, password: NEW_PASSWORD }),
		).resolves.toMatchObject({ status: 200 });
		await expect(signIn(app, ADMIN)).resolves.toMatchObject({ status: 401 });
	});

	it("finds the user whatever the case of the address", async () => {
		const { app, auth } = await signedInApp();

		await resetPassword({ auth }, ADMIN.email.toUpperCase(), NEW_PASSWORD);

		await expect(
			signIn(app, { email: ADMIN.email, password: NEW_PASSWORD }),
		).resolves.toMatchObject({ status: 200 });
	});

	it("refuses an address with no user and writes nothing", async () => {
		const { app, auth, cookie } = await signedInApp();

		await expect(resetPassword({ auth }, "nobody@example.test", NEW_PASSWORD)).rejects.toThrow(
			new PasswordResetError("unknown_user"),
		);
		expect((await accountsWith(app, cookie)).status).toBe(200);
		await expect(signIn(app, ADMIN)).resolves.toMatchObject({ status: 200 });
	});

	it.each([
		{ password: "1234567", problem: "password_too_short" },
		{ password: "x".repeat(129), problem: "password_too_long" },
	] as const)(
		"refuses a password of $problem and writes nothing",
		async ({ password, problem }) => {
			const { app, auth, cookie } = await signedInApp();

			await expect(resetPassword({ auth }, ADMIN.email, password)).rejects.toThrow(
				new PasswordResetError(problem),
			);
			expect((await accountsWith(app, cookie)).status).toBe(200);
		},
	);
});

describe("POST /api/auth/change-password", () => {
	it("refuses a fourth attempt within ten seconds", async () => {
		const { app, cookie } = await signedInApp();
		const attempt = () =>
			app.request("/api/auth/change-password", {
				method: "POST",
				headers: { "content-type": "application/json", origin: TEST_ORIGIN, cookie },
				body: JSON.stringify({
					currentPassword: "pas le bon mot de passe",
					newPassword: NEW_PASSWORD,
					revokeOtherSessions: true,
				}),
			});

		// Better Auth's own rule, shared with sign-in: three attempts per ten
		// seconds. Guessing the current password is guessing the password.
		const statuses = [
			(await attempt()).status,
			(await attempt()).status,
			(await attempt()).status,
			(await attempt()).status,
		];

		expect(statuses).toEqual([400, 400, 400, 429]);
		// Nothing was written: the password of the setup still signs in.
		await expect(signIn(app, ADMIN)).resolves.toMatchObject({ status: 200 });
	});
});
