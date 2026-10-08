import { describe, expect, it } from "vitest";

import { loggedFigures } from "./logs.ts";

describe("loggedFigures", () => {
	it("leaves out the figures a run draws, never the ones the code logs", () => {
		const line = JSON.stringify({
			level: 40,
			time: 1_791_234_567_890,
			pid: 4290,
			hostname: "runner-1200",
			importId: "3c937da9-8c84-4b15-b715-250a7b121200",
			durationMs: 1234,
			counts: { created: 4290 },
			msg: "amount 1234,56 refused",
		});

		const text = loggedFigures([line]);

		expect(text).toBe(
			'{"level":40,"importId":"<uuid>","counts":{"created":4290},"msg":"amount 1234,56 refused"}',
		);
	});
});
