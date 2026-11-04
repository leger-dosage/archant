import { describe, expect, it } from "vitest";

import { isCustomRange } from "./periods.ts";

describe("isCustomRange", () => {
	it("takes two calendar days, the first not after the second", () => {
		expect(isCustomRange("2026-10-05", "2026-10-20")).toBe(true);
		expect(isCustomRange("2026-10-05", "2026-10-05")).toBe(true);
	});

	it("refuses a range that starts after it ends", () => {
		expect(isCustomRange("2026-10-20", "2026-10-05")).toBe(false);
	});

	it("refuses a day that does not exist or does not parse", () => {
		expect(isCustomRange("2026-02-30", "2026-10-05")).toBe(false);
		expect(isCustomRange("2026-10-05", "demain")).toBe(false);
		expect(isCustomRange("2026-1-5", "2026-10-05")).toBe(false);
	});
});
