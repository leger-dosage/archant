import { createHmac } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * The code an authenticator app shows for a base32 secret now (RFC 6238:
 * HMAC-SHA1, 30-second steps, 6 digits). Test-only: the server's codes come
 * from Better Auth, never from this.
 */
export function totp(secret: string, at: number = Date.now()): string {
	const bits = secret
		.toUpperCase()
		.split("")
		.map((char) => BASE32.indexOf(char).toString(2).padStart(5, "0"))
		.join("");
	const key = Buffer.from((bits.match(/.{8}/gu) ?? []).map((byte) => Number.parseInt(byte, 2)));
	const counter = Buffer.alloc(8);
	counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
	const hmac = createHmac("sha1", key).update(counter).digest();
	const offset = (hmac.at(-1) ?? 0) & 0xf;

	return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
