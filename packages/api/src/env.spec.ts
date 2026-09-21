import { describe, expect, it } from "vitest";

import { validateEnv } from "./env.ts";

describe("validateEnv", () => {
	it("names the missing variable", () => {
		expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
	});

	it("defaults the time zone and log level, and drops an empty token", () => {
		const env = validateEnv({ DATABASE_URL: "file:../../local.db", DATABASE_AUTH_TOKEN: "" });

		expect(env.DATABASE_AUTH_TOKEN).toBeUndefined();
		expect(env.APP_TIMEZONE).toBe("Europe/Paris");
		expect(env.LOG_LEVEL).toBe("info");
	});

	it("names a time zone Intl does not know", () => {
		expect(() => validateEnv({ DATABASE_URL: "file:x.db", APP_TIMEZONE: "Mars/Olympus" })).toThrow(
			/APP_TIMEZONE/,
		);
	});

	it("names an unknown log level", () => {
		expect(() => validateEnv({ DATABASE_URL: "file:x.db", LOG_LEVEL: "loud" })).toThrow(
			/LOG_LEVEL/,
		);
	});
});
