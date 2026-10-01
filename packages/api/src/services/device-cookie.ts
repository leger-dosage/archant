import type { ServiceDeps } from "./deps.ts";
import type { CookieOptions } from "hono/utils/cookie";

import { eq } from "drizzle-orm";
import { createHmac, randomBytes } from "node:crypto";

import { users } from "@archant/data/schema/auth";

import { sameSecret } from "../lib/secret.ts";

/**
 * OWASP's device cookie: proof that this browser once signed in as a user.
 * The sign-in ceiling lets such a browser through when strangers have filled
 * it, so whoever reaches the sign-in page cannot keep the owner out.
 */
export const DEVICE_COOKIE = "archant.device";

export const DEVICE_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

// 128 bits: no one guesses another device's nonce to spend its failures.
const NONCE_BYTES = 16;

export type Device = {
	userId: string;
	/** Names this device's own failure count, so a stolen cookie spends only its own. */
	nonce: string;
	/** Epoch milliseconds, checked here: a browser's `Max-Age` is the client's word. */
	expiresAt: number;
};

// The prefix keeps this HMAC from ever matching one `BETTER_AUTH_SECRET` signs
// for something else.
function signature(secret: string, payload: string): string {
	return createHmac("sha256", secret).update(`device-cookie:${payload}`).digest("base64url");
}

/** `<userId>.<nonce>.<expiresAt>.<signature>`, with a new nonce each time. */
export function signDeviceCookie(secret: string, userId: string, now: number = Date.now()): string {
	const nonce = randomBytes(NONCE_BYTES).toString("base64url");
	const payload = `${userId}.${nonce}.${now + DEVICE_COOKIE_MAX_AGE_SECONDS * 1000}`;

	return `${payload}.${signature(secret, payload)}`;
}

/** The device a cookie names, or `null` when it is malformed, forged or expired. */
export function verifyDeviceCookie(
	secret: string,
	value: string,
	now: number = Date.now(),
): Device | null {
	const parts = value.split(".");

	if (parts.length < 4) {
		return null;
	}

	// From the right: the nonce, expiry and signature hold no dot, a user id might.
	const [nonce = "", expires = "", signed = ""] = parts.slice(-3);
	const userId = parts.slice(0, -3).join(".");

	if (userId === "" || nonce === "" || !/^\d+$/u.test(expires)) {
		return null;
	}

	if (!sameSecret(signed, signature(secret, `${userId}.${nonce}.${expires}`))) {
		return null;
	}

	const expiresAt = Number(expires);

	return expiresAt > now ? { userId, nonce, expiresAt } : null;
}

/**
 * Sent with sign-in requests only. `Strict`, so a foreign page never makes the
 * browser present it; `HttpOnly`, so no script reads it.
 */
export function deviceCookieOptions(trustedOrigin: string): CookieOptions {
	return {
		httpOnly: true,
		sameSite: "Strict",
		path: "/api/auth",
		maxAge: DEVICE_COOKIE_MAX_AGE_SECONDS,
		secure: new URL(trustedOrigin).protocol === "https:",
	};
}

/**
 * The nonce of the device `cookie` proves, when it is the device of the user
 * `email` belongs to; `null` otherwise, an unknown email included. The user
 * check keeps a cookie one account earned from unlocking another's sign-in.
 */
export async function knownDeviceNonce(
	deps: Pick<ServiceDeps, "db">,
	{ secret, cookie, email }: { secret: string; cookie: string; email: string },
): Promise<string | null> {
	const device = verifyDeviceCookie(secret, cookie);

	if (device === null) {
		return null;
	}

	// Better Auth stores and looks emails up in lower case.
	const [user] = await deps.db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.email, email.toLowerCase()))
		.limit(1);

	return user?.id === device.userId ? device.nonce : null;
}
