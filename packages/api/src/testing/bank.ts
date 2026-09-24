import { generateKeyPairSync } from "node:crypto";

/**
 * One RSA key pair per spec file, in both PEM encodings Enable Banking's
 * control panel may hand out. Generated rather than committed: a private key
 * in the repository, even a test one, is a finding in every secret scanner.
 */
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });

export const TEST_PUBLIC_KEY = pair.publicKey;
export const TEST_PRIVATE_KEY = pair.privateKey;

/** As `ENABLE_BANKING_PRIVATE_KEY` holds it: base64 of the PEM. */
export const TEST_PKCS8_BASE64 = Buffer.from(
	pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
).toString("base64");

export const TEST_PKCS1_BASE64 = Buffer.from(
	pair.privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
).toString("base64");

/** A 32-byte `ENCRYPTION_KEY`, fixed so a failure reproduces. */
export const TEST_ENCRYPTION_KEY_BASE64 = Buffer.alloc(32, 7).toString("base64");

export const TEST_APPLICATION_ID = "00000000-0000-4000-8000-00000000a11d";

export const TEST_PROVIDER_URL = "https://api.enablebanking.com";
