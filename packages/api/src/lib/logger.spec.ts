import { describe, expect, it } from "vitest";

import { createLogger } from "./logger.ts";

describe("createLogger", () => {
	it("redacts the authorization and cookie headers", () => {
		const lines: string[] = [];
		const logger = createLogger("info", { write: (line: string) => lines.push(line) });

		logger.info(
			{ req: { headers: { authorization: "Bearer secret", cookie: "session=abc" } } },
			"request",
		);

		expect(lines).toHaveLength(1);
		expect(lines[0]).not.toContain("secret");
		expect(lines[0]).not.toContain("session=abc");
		expect(lines[0]).toContain("[redacted]");
	});

	it("honours the level", () => {
		const lines: string[] = [];
		const logger = createLogger("warn", { write: (line: string) => lines.push(line) });

		logger.info("hidden");
		logger.warn("shown");

		expect(lines).toHaveLength(1);
	});
});
