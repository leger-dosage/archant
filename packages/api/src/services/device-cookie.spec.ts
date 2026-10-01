import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
	DEVICE_COOKIE_MAX_AGE_SECONDS,
	deviceCookieOptions,
	signDeviceCookie,
	verifyDeviceCookie,
} from "./device-cookie.ts";

const SECRET = "archant-test-secret-of-at-least-32-characters";
const NOW = Date.UTC(2026, 9, 1, 12);
const YEAR_MS = DEVICE_COOKIE_MAX_AGE_SECONDS * 1000;

/** A cookie for `payload`, signed as the module signs, under `secret`. */
function forge(payload: string, secret = SECRET): string {
	const signature = createHmac("sha256", secret)
		.update(`device-cookie:${payload}`)
		.digest("base64url");

	return `${payload}.${signature}`;
}

describe("the device cookie", () => {
	it("verifies the cookie it signed, naming the user, a 128-bit nonce and an expiry a year away", () => {
		const value = signDeviceCookie(SECRET, "user-1", NOW);

		const device = verifyDeviceCookie(SECRET, value, NOW);

		expect(device).toMatchObject({ userId: "user-1", expiresAt: NOW + YEAR_MS });
		expect(device?.nonce).toMatch(/^[\w-]{22}$/u);
		expect(value).toBe(forge(`user-1.${device?.nonce}.${NOW + YEAR_MS}`));
	});

	it("draws a new nonce at every signature", () => {
		const first = verifyDeviceCookie(SECRET, signDeviceCookie(SECRET, "user-1", NOW), NOW);
		const second = verifyDeviceCookie(SECRET, signDeviceCookie(SECRET, "user-1", NOW), NOW);

		expect(first?.nonce).not.toBe(second?.nonce);
	});

	it("refuses a forged signature, and a cookie signed under another secret", () => {
		const value = signDeviceCookie(SECRET, "user-1", NOW);
		const forged = `${value.slice(0, -1)}${value.endsWith("A") ? "B" : "A"}`;

		expect(verifyDeviceCookie(SECRET, forged, NOW)).toBeNull();
		expect(
			verifyDeviceCookie(SECRET, forge(`user-1.nonce.${NOW + 1000}`, "another secret"), NOW),
		).toBeNull();
	});

	it("refuses a cookie whose user was changed after signing", () => {
		const [, ...rest] = signDeviceCookie(SECRET, "user-1", NOW).split(".");

		expect(verifyDeviceCookie(SECRET, ["user-2", ...rest].join("."), NOW)).toBeNull();
	});

	it("refuses a cookie past its expiry, and one whose expiry was pushed back", () => {
		const value = signDeviceCookie(SECRET, "user-1", NOW);
		const [user, nonce, , signature] = value.split(".");

		expect(verifyDeviceCookie(SECRET, value, NOW + YEAR_MS - 1)).not.toBeNull();
		expect(verifyDeviceCookie(SECRET, value, NOW + YEAR_MS)).toBeNull();
		expect(
			verifyDeviceCookie(SECRET, `${user}.${nonce}.${NOW + 2 * YEAR_MS}.${signature}`, NOW),
		).toBeNull();
	});

	it.each([
		["empty", ""],
		["without a signature", "user-1.nonce.1"],
		["with an empty user", forge(`.nonce.${NOW + 1000}`)],
		["with an empty nonce", forge(`user-1..${NOW + 1000}`)],
		["with an expiry that is not a number", forge("user-1.nonce.soon")],
	])("refuses a malformed cookie, %s", (_, value) => {
		expect(verifyDeviceCookie(SECRET, value, NOW)).toBeNull();
	});

	it("keeps a user id holding a dot whole", () => {
		const device = verifyDeviceCookie(SECRET, signDeviceCookie(SECRET, "user.1", NOW), NOW);

		expect(device?.userId).toBe("user.1");
	});

	it("is HttpOnly, SameSite=Strict, scoped to /api/auth, a year long, and Secure over https", () => {
		expect(deviceCookieOptions("https://archant.example")).toEqual({
			httpOnly: true,
			sameSite: "Strict",
			path: "/api/auth",
			maxAge: DEVICE_COOKIE_MAX_AGE_SECONDS,
			secure: true,
		});
		expect(deviceCookieOptions("http://localhost:5173")).toMatchObject({ secure: false });
		expect(DEVICE_COOKIE_MAX_AGE_SECONDS).toBe(365 * 24 * 60 * 60);
	});
});
