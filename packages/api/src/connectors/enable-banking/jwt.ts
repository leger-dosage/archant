import type { KeyObject } from "node:crypto";

import { SignJWT } from "jose";

/** Enable Banking refuses a token valid for longer than a day; Sure signs for an hour. */
const LIFETIME_SECONDS = 3600;

/**
 * The bearer token Enable Banking expects, signed with the application's
 * private key. One per request, as in Sure: nothing to cache or refresh.
 */
export async function signJwt(
	applicationId: string,
	privateKey: KeyObject,
	now: number = Date.now(),
): Promise<string> {
	const issuedAt = Math.floor(now / 1000);

	return new SignJWT({})
		.setProtectedHeader({ typ: "JWT", alg: "RS256", kid: applicationId })
		.setIssuer("enablebanking.com")
		.setAudience("api.enablebanking.com")
		.setIssuedAt(issuedAt)
		.setExpirationTime(issuedAt + LIFETIME_SECONDS)
		.sign(privateKey);
}
