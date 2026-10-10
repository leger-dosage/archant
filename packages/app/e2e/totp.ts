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

const STEP_MS = 30_000;

/** The last step handed out per secret, so no step is handed out twice. */
const lastSteps = new Map<string, number>();

/**
 * A code the server has not seen yet, for a submission that reaches it: the
 * server accepts each step once (Story 27.8), and a step stays current for 30
 * seconds. Once the current step is spent, the next one's code, which the
 * server accepts a step early; once that is spent too, it waits for the step
 * to come. A code refused for being wrong or answered by a mocked route can
 * still use `totp`.
 */
export async function freshTotp(secret: string): Promise<string> {
	const current = Math.floor(Date.now() / STEP_MS);
	const step = Math.max(current, (lastSteps.get(secret) ?? current - 1) + 1);
	const wait = (step - 1) * STEP_MS - Date.now();

	if (wait > 0) {
		await new Promise((resolve) => setTimeout(resolve, wait));
	}

	lastSteps.set(secret, step);

	return totp(secret, step * STEP_MS);
}
