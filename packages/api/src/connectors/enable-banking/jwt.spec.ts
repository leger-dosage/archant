import { decodeProtectedHeader, jwtVerify } from "jose";
import { createPrivateKey } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
	TEST_APPLICATION_ID,
	TEST_PKCS1_BASE64,
	TEST_PKCS8_BASE64,
	TEST_PUBLIC_KEY,
} from "../../testing/bank.ts";
import { signJwt } from "./jwt.ts";

const keyFrom = (base64: string) => createPrivateKey(Buffer.from(base64, "base64").toString());

describe("signJwt", () => {
	it.each([
		["PKCS#8", TEST_PKCS8_BASE64],
		["PKCS#1", TEST_PKCS1_BASE64],
	])("signs with a %s key a token the public key verifies", async (_, base64) => {
		const now = Date.parse("2026-09-24T10:00:00.900Z");
		const token = await signJwt(TEST_APPLICATION_ID, keyFrom(base64), now);

		expect(decodeProtectedHeader(token)).toEqual({
			typ: "JWT",
			alg: "RS256",
			kid: TEST_APPLICATION_ID,
		});

		const { payload } = await jwtVerify(token, TEST_PUBLIC_KEY, {
			issuer: "enablebanking.com",
			audience: "api.enablebanking.com",
			currentDate: new Date(now),
		});
		const issuedAt = Math.floor(now / 1000);

		expect(payload).toEqual({
			iss: "enablebanking.com",
			aud: "api.enablebanking.com",
			iat: issuedAt,
			exp: issuedAt + 3600,
		});
	});

	it("defaults to the current time", async () => {
		const before = Math.floor(Date.now() / 1000);
		const token = await signJwt(TEST_APPLICATION_ID, keyFrom(TEST_PKCS8_BASE64));
		const { payload } = await jwtVerify(token, TEST_PUBLIC_KEY);

		expect(payload.iat).toBeGreaterThanOrEqual(before);
		expect(payload.exp).toBe((payload.iat ?? 0) + 3600);
	});
});
