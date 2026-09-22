import { describe, expect, it } from "vitest";

import { validateEnv } from "./env.ts";

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
});
