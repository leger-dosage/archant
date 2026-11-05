import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import {
	capitalised,
	drilldownAccounts,
	pickerMonths,
	spendingDelta,
} from "@/lib/dashboard-months";

describe("pickerMonths", () => {
	it("offers this month and the eleven before it, across a new year", () => {
		expect(pickerMonths("2026-03")).toEqual([
			"2026-03",
			"2026-02",
			"2026-01",
			"2025-12",
			"2025-11",
			"2025-10",
			"2025-09",
			"2025-08",
			"2025-07",
			"2025-06",
			"2025-05",
			"2025-04",
		]);
	});
});

describe("capitalised", () => {
	it("capitalises a month's name alone", () => {
		expect(capitalised("août 2026")).toBe("Août 2026");
		expect(capitalised("")).toBe("");
	});
});

describe("spendingDelta", () => {
	it("is what the month spent beyond the previous one, negative when it spent less", () => {
		expect(spendingDelta(toMinorUnits(-12_000), toMinorUnits(-10_000))).toBe(2_000);
		expect(spendingDelta(toMinorUnits(-5_000), toMinorUnits(-10_000))).toBe(-5_000);
		expect(spendingDelta(toMinorUnits(0), toMinorUnits(0))).toBe(0);
	});
});

describe("drilldownAccounts", () => {
	it("drops the filter when the widget counts every account the list shows, and keeps it otherwise", () => {
		expect(drilldownAccounts(["b", "a"], ["a", "b"])).toBeUndefined();
		expect(drilldownAccounts(["a"], ["a", "b"])).toEqual(["a"]);
		// A PEA the widget never counts: the list must not show its rows.
		expect(drilldownAccounts(["a", "b"], ["a", "b", "pea"])).toEqual(["a", "b"]);
	});
});
