import { describe, expect, it } from "vitest";

import { daysInMonth, shiftMonth } from "./months.ts";

describe("shiftMonth", () => {
	it("moves by months across years in both directions", () => {
		expect(shiftMonth("2026-09", -1)).toBe("2026-08");
		expect(shiftMonth("2026-01", -1)).toBe("2025-12");
		expect(shiftMonth("2026-12", 1)).toBe("2027-01");
		expect(shiftMonth("2026-09", 0)).toBe("2026-09");
		expect(shiftMonth("2026-11", 3)).toBe("2027-02");
		expect(shiftMonth("2026-09", -12)).toBe("2025-09");
	});
});

describe("daysInMonth", () => {
	it("counts thirty or thirty-one days outside February", () => {
		expect(daysInMonth(2026, 1)).toBe(31);
		expect(daysInMonth(2026, 4)).toBe(30);
		expect(daysInMonth(2026, 9)).toBe(30);
		expect(daysInMonth(2026, 12)).toBe(31);
	});

	it("follows the Gregorian leap years in February", () => {
		expect(daysInMonth(2026, 2)).toBe(28);
		expect(daysInMonth(2028, 2)).toBe(29);
		expect(daysInMonth(1900, 2)).toBe(28);
		expect(daysInMonth(2000, 2)).toBe(29);
	});
});
