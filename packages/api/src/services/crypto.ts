import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
// GCM's recommended nonce size. Random per call: with one key for the life of
// the instance, a repeated nonce would leak the XOR of two plaintexts.
const IV_BYTES = 12;
const TAG_BYTES = 16;
// A prefix per format, so a later key rotation or algorithm change can read
// both the old and the new values during its migration.
const VERSION = "v1";

/**
 * Encrypts a secret for storage as `v1:<iv>:<tag>:<ciphertext>`, each part
 * base64. `key` is `ENCRYPTION_KEY`, 32 bytes.
 */
export function encrypt(key: Uint8Array, plaintext: string): string {
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
	const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

	return [
		VERSION,
		iv.toString("base64"),
		cipher.getAuthTag().toString("base64"),
		ciphertext.toString("base64"),
	].join(":");
}

/**
 * The secret `encrypt` stored. Throws on another format, another key or any
 * altered byte: GCM's tag authenticates the ciphertext.
 */
export function decrypt(key: Uint8Array, stored: string): string {
	const [version, iv, tag, ciphertext, ...rest] = stored.split(":");

	if (
		version !== VERSION ||
		iv === undefined ||
		tag === undefined ||
		ciphertext === undefined ||
		rest.length > 0
	) {
		throw new Error("Unknown encrypted value format.");
	}

	const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, "base64"), {
		authTagLength: TAG_BYTES,
	});
	decipher.setAuthTag(Buffer.from(tag, "base64"));

	return Buffer.concat([
		decipher.update(Buffer.from(ciphertext, "base64")),
		decipher.final(),
	]).toString("utf8");
}
