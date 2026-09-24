import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";

import { validateEnv } from "./env.ts";
import {
	TEST_ENCRYPTION_KEY_BASE64,
	TEST_PKCS1_BASE64,
	TEST_PKCS8_BASE64,
} from "./testing/bank.ts";

const required = {
	DATABASE_URL: "file:x.db",
	BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
	BETTER_AUTH_URL: "http://localhost:5173",
};

describe("validateEnv", () => {
	it("names every missing variable", () => {
		expect(() => validateEnv({})).toThrow(/DATABASE_URL.*BETTER_AUTH_SECRET.*BETTER_AUTH_URL/u);
	});

	it("defaults the time zone and log level, and drops an empty token", () => {
		const env = validateEnv({
			...required,
			DATABASE_URL: "file:../../local.db",
			DATABASE_AUTH_TOKEN: "",
		});

		expect(env.DATABASE_AUTH_TOKEN).toBeUndefined();
		expect(env.APP_TIMEZONE).toBe("Europe/Paris");
		expect(env.LOG_LEVEL).toBe("info");
		expect(env.PORT).toBe(8787);
		expect(env.BETTER_AUTH_URL).toBe("http://localhost:5173");
		expect(env.TRUSTED_PROXIES).toEqual([]);
		expect(env.WEB_DIST).toBeUndefined();
		expect(env.ENABLE_BANKING_APPLICATION_ID).toBeUndefined();
		expect(env.ENABLE_BANKING_PRIVATE_KEY).toBeUndefined();
		expect(env.ENCRYPTION_KEY).toBeUndefined();
		expect(env.ENABLE_BANKING_API_URL).toBe("https://api.enablebanking.com");
		expect(env.SYNC_SECRET).toBeUndefined();
	});

	it("accepts an absolute WEB_DIST and names a relative one", () => {
		expect(validateEnv({ ...required, WEB_DIST: "/app/packages/web/dist" }).WEB_DIST).toBe(
			"/app/packages/web/dist",
		);
		expect(() => validateEnv({ ...required, WEB_DIST: "packages/web/dist" })).toThrow(/WEB_DIST/);
	});

	it("reads the port as a number and names one out of range", () => {
		expect(validateEnv({ ...required, PORT: "8788" }).PORT).toBe(8788);
		expect(() => validateEnv({ ...required, PORT: "70000" })).toThrow(/PORT/);
	});

	it("names a time zone Intl does not know", () => {
		expect(() => validateEnv({ ...required, APP_TIMEZONE: "Mars/Olympus" })).toThrow(
			/APP_TIMEZONE/,
		);
	});

	it("names an unknown log level", () => {
		expect(() => validateEnv({ ...required, LOG_LEVEL: "loud" })).toThrow(/LOG_LEVEL/);
	});

	it("names a secret shorter than 32 characters", () => {
		expect(() => validateEnv({ ...required, BETTER_AUTH_SECRET: "short" })).toThrow(
			/BETTER_AUTH_SECRET/,
		);
	});

	it.each([
		"localhost:5173",
		"ftp://localhost",
		"http://localhost:5173/app",
		"http://localhost:5173/?x=1",
		"http://localhost:5173/#top",
	])("names the origin %j", (url) => {
		expect(() => validateEnv({ ...required, BETTER_AUTH_URL: url })).toThrow(/BETTER_AUTH_URL/);
	});

	it("reads trusted proxies as a list of addresses and ranges", () => {
		expect(
			validateEnv({ ...required, TRUSTED_PROXIES: "127.0.0.1, ::1,10.0.0.0/8" }).TRUSTED_PROXIES,
		).toEqual(["127.0.0.1", "::1", "10.0.0.0/8"]);
	});

	it.each(["localhost", "10.0.0.0/33", "127.0.0.1;rm"])("names the proxy %j", (entry) => {
		expect(() => validateEnv({ ...required, TRUSTED_PROXIES: entry })).toThrow(/TRUSTED_PROXIES/);
	});

	it.each([
		["PKCS#8", TEST_PKCS8_BASE64],
		["PKCS#1", TEST_PKCS1_BASE64],
	])("reads a %s private key and a 32-byte encryption key", (_, key) => {
		const env = validateEnv({
			...required,
			ENABLE_BANKING_APPLICATION_ID: "app-id",
			ENABLE_BANKING_PRIVATE_KEY: key,
			ENCRYPTION_KEY: TEST_ENCRYPTION_KEY_BASE64,
			ENABLE_BANKING_API_URL: "http://localhost:9999",
		});

		expect(env.ENABLE_BANKING_PRIVATE_KEY?.asymmetricKeyType).toBe("rsa");
		expect(env.ENCRYPTION_KEY?.length).toBe(32);
		expect(env.ENABLE_BANKING_API_URL).toBe("http://localhost:9999");
	});

	it.each([
		["not base64 of a PEM", Buffer.from("hello").toString("base64")],
		["a raw PEM", "-----BEGIN PRIVATE KEY-----"],
		[
			"an EC key",
			Buffer.from(
				generateKeyPairSync("ec", { namedCurve: "P-256" })
					.privateKey.export({ type: "pkcs8", format: "pem" })
					.toString(),
			).toString("base64"),
		],
	])("names a private key that is %s", (_, key) => {
		expect(() => validateEnv({ ...required, ENABLE_BANKING_PRIVATE_KEY: key })).toThrow(
			/ENABLE_BANKING_PRIVATE_KEY/,
		);
	});

	it.each([
		["16 bytes", Buffer.alloc(16).toString("base64")],
		["33 bytes", Buffer.alloc(33).toString("base64")],
		["not base64", "not base64 at all!"],
	])("names an encryption key of %s", (_, key) => {
		expect(() => validateEnv({ ...required, ENCRYPTION_KEY: key })).toThrow(/ENCRYPTION_KEY/);
	});

	it("names an application id made of spaces only", () => {
		expect(() => validateEnv({ ...required, ENABLE_BANKING_APPLICATION_ID: "   " })).toThrow(
			/ENABLE_BANKING_APPLICATION_ID/,
		);
	});

	it("names a provider URL that is not http", () => {
		expect(() =>
			validateEnv({ ...required, ENABLE_BANKING_API_URL: "ftp://api.enablebanking.com" }),
		).toThrow(/ENABLE_BANKING_API_URL/);
	});

	it("reads a sync secret of 32 characters or more, and names a shorter one", () => {
		expect(validateEnv({ ...required, SYNC_SECRET: "s".repeat(32) }).SYNC_SECRET).toBe(
			"s".repeat(32),
		);
		expect(() => validateEnv({ ...required, SYNC_SECRET: "s".repeat(31) })).toThrow(/SYNC_SECRET/);
	});
});
