import type { RecurrenceRule } from "./schedule.ts";

import { describe, expect, it } from "vitest";

import { cyclesOverdue, nextDueDateOf, nextDueDates } from "./bills.ts";

const monthly = (day: number): RecurrenceRule => ({
	frequency: "monthly",
	interval: 1,
	dayOfMonth: day,
});

const series = (rules: RecurrenceRule[], anchorDate: string | null, manual = true) => ({
	rules,
	anchorDate,
	lastOccurrenceDate: "2026-09-15",
	endAfterCount: null,
	expectedDayOfMonth: 15,
	manual,
});

describe("nextDueDateOf", () => {
	it("reads the open occurrence's effective date, else the next expected date", () => {
		const open = { status: "scheduled" as const, effectiveDueOn: "2026-10-20" };

		expect(nextDueDateOf({ nextExpectedDate: "2026-10-15", currentOccurrence: open })).toBe(
			"2026-10-20",
		);
		expect(
			nextDueDateOf({
				nextExpectedDate: "2026-10-15",
				currentOccurrence: { ...open, status: "paid" },
			}),
		).toBe("2026-10-15");
		expect(nextDueDateOf({ nextExpectedDate: "2026-10-15", currentOccurrence: null })).toBe(
			"2026-10-15",
		);
	});
});

describe("nextDueDates", () => {
	it("starts a declared bill at its first due date, and any other at the date given", () => {
		const ahead = series([monthly(15)], "2026-12-15");

		expect(nextDueDates(ahead, "2026-09-21")).toEqual(["2026-12-15", "2027-01-15", "2027-02-15"]);
		expect(nextDueDates({ ...ahead, manual: false }, "2026-09-21")).toEqual([
			"2026-10-15",
			"2026-11-15",
			"2026-12-15",
		]);
		expect(nextDueDates({ ...ahead, anchorDate: null }, "2026-09-21", 1)).toEqual(["2026-10-15"]);
	});
});

describe("cyclesOverdue", () => {
	it("counts whole cycles of the series' own cadence since its next due date", () => {
		const weekly = series([{ frequency: "weekly", interval: 1, weekday: 2 }], null);
		const yearly = series(
			[{ frequency: "yearly", interval: 1, dayOfMonth: 1, monthOfYear: 12 }],
			null,
		);

		expect(cyclesOverdue(weekly, "2026-09-06", "2026-09-21")).toBe(2);
		expect(cyclesOverdue(weekly, "2026-09-21", "2026-09-21")).toBe(0);
		expect(cyclesOverdue(yearly, "2025-09-20", "2026-09-21")).toBe(1);
		expect(cyclesOverdue(yearly, "2026-09-20", "2026-09-21")).toBe(0);
		// A monthly bill 40 days late has missed one cycle, 20 days late none.
		expect(cyclesOverdue(series([monthly(12)], null), "2026-08-12", "2026-09-21")).toBe(1);
		expect(cyclesOverdue(series([monthly(1)], null), "2026-09-01", "2026-09-21")).toBe(0);
	});
});
