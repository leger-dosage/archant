import { describe, expect, it } from "vitest";

import { decrypt, encrypt } from "./crypto.ts";

const key = Buffer.alloc(32, 1);
const other = Buffer.alloc(32, 2);

describe("encrypt", () => {
	it("round-trips through decrypt", () => {
		expect(decrypt(key, encrypt(key, "session-éè-123"))).toBe("session-éè-123");
	});

	it("stores v1:<iv>:<tag>:<ciphertext> in base64, without the plaintext", () => {
		const stored = encrypt(key, "a-session-id");
		const [version, iv, tag, ciphertext] = stored.split(":");

		expect(stored.split(":")).toHaveLength(4);
		expect(version).toBe("v1");
		expect(Buffer.from(iv ?? "", "base64")).toHaveLength(12);
		expect(Buffer.from(tag ?? "", "base64")).toHaveLength(16);
		expect(Buffer.from(ciphertext ?? "", "base64")).toHaveLength("a-session-id".length);
		expect(stored).not.toContain("a-session-id");
	});

	it("draws a fresh IV on every call", () => {
		const first = encrypt(key, "same");
		const second = encrypt(key, "same");

		expect(first.split(":")[1]).not.toBe(second.split(":")[1]);
		expect(first).not.toBe(second);
	});
});

describe("decrypt", () => {
	it("refuses a tampered tag", () => {
		const [version, iv, tag = "", ciphertext] = encrypt(key, "secret").split(":");
		const bytes = Buffer.from(tag, "base64");
		bytes[0] = (bytes[0] ?? 0) ^ 0xff;

		expect(() =>
			decrypt(key, [version, iv, bytes.toString("base64"), ciphertext].join(":")),
		).toThrow();
	});

	it("refuses a tampered ciphertext and another key", () => {
		const stored = encrypt(key, "secret");
		const [version, iv, tag, ciphertext = ""] = stored.split(":");
		const bytes = Buffer.from(ciphertext, "base64");
		bytes[0] = (bytes[0] ?? 0) ^ 0xff;

		expect(() => decrypt(key, [version, iv, tag, bytes.toString("base64")].join(":"))).toThrow();
		expect(() => decrypt(other, stored)).toThrow();
	});

	it.each(["v2:a:b:c", "v1:a:b", "v1:a:b:c:d", "plain"])("refuses the format %j", (stored) => {
		expect(() => decrypt(key, stored)).toThrow(/format/);
	});
});
