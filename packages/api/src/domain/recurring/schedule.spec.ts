import type { RecurrenceRule, Schedule } from "./schedule.ts";

import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import {
	cycleFor,
	dueFrom,
	firstOccurrenceAfter,
	matchesDay,
	monthlyEquivalent,
	monthlyOn,
	nextExpectedAfter,
	nextOccurrenceAfter,
	nextOccurrenceFromToday,
	occurrencesBetween,
	occurrencesPerYear,
	planEnd,
} from "./schedule.ts";

const TODAY = "2026-09-21";

function schedule(
	rules: readonly RecurrenceRule[],
	overrides: Partial<Omit<Schedule, "rules">> = {},
): Schedule {
	const first = rules[0];

	return {
		rules,
		anchorDate: "2026-09-05",
		endAfterCount: null,
		expectedDayOfMonth: first !== undefined && "dayOfMonth" in first ? first.dayOfMonth : 5,
		...overrides,
	};
}

const monthly = (day: number, interval = 1): RecurrenceRule => ({
	frequency: "monthly",
	interval,
	dayOfMonth: day,
});

const weekly = (weekday: number, interval = 1): RecurrenceRule => ({
	frequency: "weekly",
	interval,
	weekday,
});

const yearly = (day: number, month: number, interval = 1): RecurrenceRule => ({
	frequency: "yearly",
	interval,
	dayOfMonth: day,
	monthOfYear: month,
});

// Monday 21 September 2026: weekday 1.
const MONDAY = 1;

/** Three monthly payments on the 5th from 5 January 2026. */
const installment = schedule([monthly(5)], { anchorDate: "2026-01-05", endAfterCount: 3 });

describe("occurrencesBetween", () => {
	it("clamps the 31st to each month's end", () => {
		expect(occurrencesBetween(schedule([monthly(31)]), "2026-01-15", "2026-03-31")).toEqual([
			"2026-01-31",
			"2026-02-28",
			"2026-03-31",
		]);
	});

	it("takes the last day of each month for −1", () => {
		expect(occurrencesBetween(schedule([monthly(-1)]), "2028-02-01", "2028-04-15")).toEqual([
			"2028-02-29",
			"2028-03-31",
		]);
	});

	it("counts every N months from the anchor's month, backward as well as forward", () => {
		const quarterly = schedule([monthly(10, 3)], { anchorDate: "2026-02-10" });

		expect(occurrencesBetween(quarterly, "2026-02-11", "2026-08-31")).toEqual([
			"2026-05-10",
			"2026-08-10",
		]);
		expect(occurrencesBetween(quarterly, "2025-10-01", "2026-02-10")).toEqual([
			"2025-11-10",
			"2026-02-10",
		]);
	});

	it("counts weeks from the anchor's week, backward as well as forward", () => {
		// The anchor is a Wednesday: the first Monday on or after it is 21 September.
		const biweekly = schedule([weekly(MONDAY, 2)], { anchorDate: "2026-09-16" });

		expect(occurrencesBetween(biweekly, "2026-08-01", "2026-10-06")).toEqual([
			"2026-08-10",
			"2026-08-24",
			"2026-09-07",
			"2026-09-21",
			"2026-10-05",
		]);
		expect(occurrencesBetween(schedule([weekly(0)]), "2026-09-01", "2026-09-14")).toEqual([
			"2026-09-06",
			"2026-09-13",
		]);
	});

	it("counts every N years from the anchor's year", () => {
		const everyOtherYear = schedule([yearly(15, 3, 2)], { anchorDate: "2026-03-15" });

		expect(occurrencesBetween(everyOtherYear, "2023-01-01", "2029-12-31")).toEqual([
			"2024-03-15",
			"2026-03-15",
			"2028-03-15",
		]);
		expect(occurrencesBetween(everyOtherYear, "2026-03-16", "2028-03-14")).toEqual([]);
		expect(occurrencesBetween(schedule([yearly(-1, 2)]), "2027-01-01", "2028-12-31")).toEqual([
			"2027-02-28",
			"2028-02-29",
		]);
	});

	it("merges several rules into one sorted list, each date once", () => {
		expect(
			occurrencesBetween(schedule([monthly(15), monthly(1)]), "2026-09-01", "2026-10-14"),
		).toEqual(["2026-09-01", "2026-09-15", "2026-10-01"]);
		expect(
			occurrencesBetween(schedule([monthly(31), monthly(-1)]), "2026-09-01", "2026-10-31"),
		).toEqual(["2026-09-30", "2026-10-31"]);
	});

	it("keeps an installment's first N occurrences from its anchor, and none past them", () => {
		expect(occurrencesBetween(installment, "2025-11-01", "2026-12-31")).toEqual([
			"2026-01-05",
			"2026-02-05",
			"2026-03-05",
		]);
		expect(occurrencesBetween(installment, "2026-03-06", "2026-12-31")).toEqual([]);
		expect(occurrencesBetween(installment, "2026-02-01", "2026-02-28")).toEqual(["2026-02-05"]);
		// A plan whose anchor lies past the window leaks nothing into it.
		expect(
			occurrencesBetween({ ...installment, anchorDate: "2026-12-05" }, "2026-09-01", "2026-09-30"),
		).toEqual([]);
	});

	it("is empty when the range is", () => {
		expect(occurrencesBetween(schedule([monthly(5)]), "2026-09-30", "2026-09-01")).toEqual([]);
	});
});

describe("firstOccurrenceAfter", () => {
	it("takes the first occurrence strictly after the date", () => {
		expect(firstOccurrenceAfter(schedule([monthly(5)]), "2026-09-05")).toBe("2026-10-05");
		expect(firstOccurrenceAfter(schedule([monthly(5)]), "2026-09-04")).toBe("2026-09-05");
		expect(
			firstOccurrenceAfter(schedule([yearly(1, 1, 5)], { anchorDate: "2026-01-01" }), TODAY),
		).toBe("2031-01-01");
	});

	it("answers null once an installment has ended", () => {
		expect(firstOccurrenceAfter(installment, "2026-03-04")).toBe("2026-03-05");
		expect(firstOccurrenceAfter(installment, "2026-03-05")).toBeNull();
	});

	it("searches past windows for an installment anchored ahead, up to ten years", () => {
		expect(firstOccurrenceAfter({ ...installment, anchorDate: "2027-01-05" }, "2026-01-01")).toBe(
			"2027-01-05",
		);
		expect(
			firstOccurrenceAfter({ ...installment, anchorDate: "2040-01-05" }, "2026-01-01"),
		).toBeNull();
	});
});

describe("cycleFor", () => {
	it("runs from the occurrence on or before the date to the next one", () => {
		const bill = schedule([monthly(10)]);

		expect(cycleFor(bill, "2026-09-15")).toEqual({ start: "2026-09-10", end: "2026-10-10" });
		expect(cycleFor(bill, "2026-09-10")).toEqual({ start: "2026-09-10", end: "2026-10-10" });
		expect(cycleFor(bill, "2026-09-09")).toEqual({ start: "2026-08-10", end: "2026-09-10" });
	});

	it("starts an installment's first cycle on its anchor, and has none once it ended", () => {
		expect(cycleFor(installment, "2025-12-01")).toEqual({
			start: "2026-01-05",
			end: "2026-02-05",
		});
		expect(cycleFor(installment, "2026-03-20")).toBeNull();
		expect(cycleFor(installment, "2027-06-01")).toBeNull();
	});
});

describe("occurrencesPerYear", () => {
	it("sums each rule's yearly count", () => {
		expect(occurrencesPerYear(schedule([monthly(5)]))).toBe(12);
		expect(occurrencesPerYear(schedule([monthly(5, 3)]))).toBe(4);
		expect(occurrencesPerYear(schedule([monthly(1), monthly(15)]))).toBe(24);
		expect(occurrencesPerYear(schedule([weekly(MONDAY)]))).toBeCloseTo(52.18, 2);
		expect(occurrencesPerYear(schedule([weekly(MONDAY, 2)]))).toBeCloseTo(26.09, 2);
		expect(occurrencesPerYear(schedule([yearly(1, 1)]))).toBe(1);
		expect(occurrencesPerYear(schedule([yearly(1, 1, 2)]))).toBe(0.5);
	});
});

const euros = (amount: number) => toMinorUnits(amount);

describe("monthlyEquivalent", () => {
	it("counts a weekly rule 1461 / 28 times a month's twelfth, exactly", () => {
		// 10 × 1461 / 336 = 43,482…
		expect(monthlyEquivalent([weekly(MONDAY)], euros(-1000))).toBe(4348);
		expect(monthlyEquivalent([weekly(MONDAY, 2)], euros(-1000))).toBe(2174);
	});

	it("divides an every-N cadence and sums several rules", () => {
		expect(monthlyEquivalent([monthly(10, 3)], euros(-9000))).toBe(3000);
		expect(monthlyEquivalent([monthly(1), monthly(15)], euros(-5000))).toBe(10_000);
		expect(monthlyEquivalent([monthly(5)], euros(57_129))).toBe(57_129);
		expect(monthlyEquivalent([yearly(1, 1)], euros(12_000))).toBe(1000);
		expect(monthlyEquivalent([yearly(1, 1, 2)], euros(12_000))).toBe(500);
	});

	it("rounds an exact half up, as Sure's `number_to_currency`", () => {
		// 0,06 € a year is half a cent a month.
		expect(monthlyEquivalent([yearly(1, 1)], euros(6))).toBe(1);
		expect(monthlyEquivalent([yearly(1, 1)], euros(5))).toBe(0);
	});
});

describe("matchesDay", () => {
	it("takes a date within 2 days of a monthly occurrence, across the month end", () => {
		const bill = schedule([monthly(5)]);

		expect(matchesDay(bill, "2026-09-03")).toBe(true);
		expect(matchesDay(bill, "2026-09-07")).toBe(true);
		expect(matchesDay(bill, "2026-09-08")).toBe(false);
		expect(matchesDay(bill, "2026-09-02")).toBe(false);
		expect(matchesDay(schedule([monthly(1)]), "2026-09-30")).toBe(true);
		// The 31st is the 30th in September.
		expect(matchesDay(schedule([monthly(31)]), "2026-09-28")).toBe(true);
	});

	it("takes a weekly rule on its exact weekday only", () => {
		const weeklyMonday = schedule([weekly(MONDAY)]);

		expect(matchesDay(weeklyMonday, "2026-09-21")).toBe(true);
		expect(matchesDay(weeklyMonday, "2026-09-22")).toBe(false);
	});

	it("refuses a date in the wrong cycle of an every-N cadence", () => {
		const quarterly = schedule([monthly(10, 3)], { anchorDate: "2026-02-10" });

		expect(matchesDay(quarterly, "2026-05-11")).toBe(true);
		expect(matchesDay(quarterly, "2026-03-10")).toBe(false);
	});

	it("claims only an installment's own payments", () => {
		expect(matchesDay(installment, "2026-03-06")).toBe(true);
		expect(matchesDay(installment, "2026-04-05")).toBe(false);
		expect(matchesDay(installment, "2025-12-05")).toBe(false);
	});
});

describe("nextOccurrenceAfter", () => {
	it("takes a plain monthly series' day in the following month, clamped", () => {
		expect(nextOccurrenceAfter(schedule([monthly(5)]), "2026-09-02")).toBe("2026-10-05");
		expect(nextOccurrenceAfter(schedule([monthly(31)]), "2026-01-31")).toBe("2026-02-28");
	});

	it("asks the schedule for any other", () => {
		const quarterly = schedule([monthly(10, 3)], { anchorDate: "2026-02-10" });

		expect(nextOccurrenceAfter(quarterly, "2026-05-10")).toBe("2026-08-10");
		expect(nextOccurrenceAfter(schedule([monthly(-1)]), "2026-09-30")).toBe("2026-10-31");
		expect(nextOccurrenceAfter(installment, "2026-01-05")).toBe("2026-02-05");
		expect(nextOccurrenceAfter(schedule([monthly(1), monthly(15)]), "2026-09-01")).toBe(
			"2026-09-15",
		);
	});
});

describe("nextOccurrenceFromToday", () => {
	it("takes a plain monthly series' day this month when still ahead, else next month's", () => {
		expect(nextOccurrenceFromToday(schedule([monthly(25)]), TODAY)).toBe("2026-09-25");
		expect(nextOccurrenceFromToday(schedule([monthly(21)]), TODAY)).toBe("2026-10-21");
		expect(nextOccurrenceFromToday(schedule([monthly(20)]), TODAY)).toBe("2026-10-20");
		expect(nextOccurrenceFromToday(schedule([monthly(31)]), "2026-10-21")).toBe("2026-10-31");
	});

	it("keeps Sure's quirk: a day the month lacks skips to the next month", () => {
		expect(nextOccurrenceFromToday(schedule([monthly(31)]), TODAY)).toBe("2026-10-31");
		expect(nextOccurrenceFromToday(schedule([monthly(31)]), "2027-01-31")).toBe("2027-02-28");
	});

	it("asks the schedule for any other", () => {
		expect(nextOccurrenceFromToday(schedule([weekly(MONDAY)]), TODAY)).toBe("2026-09-28");
	});
});

/** A plain monthly schedule on `day`. */
const plain = (day: number) => schedule([monthly(day)]);

describe("nextExpectedAfter", () => {
	it("takes the expected day of the next month when the row came on time", () => {
		expect(nextExpectedAfter(plain(5), "2026-09-05")).toBe("2026-10-05");
		expect(nextExpectedAfter(plain(5), "2026-09-03")).toBe("2026-10-05");
		expect(nextExpectedAfter(plain(5), "2026-09-07")).toBe("2026-10-05");
	});

	it("moves a month on for a row that came early across the month end", () => {
		expect(nextExpectedAfter(plain(1), "2026-08-31")).toBe("2026-10-01");
		expect(nextExpectedAfter(plain(2), "2026-08-30")).toBe("2026-10-02");
	});

	it("moves a month back for a row that came late across the month end", () => {
		expect(nextExpectedAfter(plain(30), "2026-09-02")).toBe("2026-09-30");
		expect(nextExpectedAfter(plain(31), "2026-09-01")).toBe("2026-09-30");
	});

	it("clamps the month end to a shorter month", () => {
		expect(nextExpectedAfter(plain(31), "2026-01-31")).toBe("2026-02-28");
		expect(nextExpectedAfter(plain(31), "2026-08-31")).toBe("2026-09-30");
	});

	it("keeps the target's month on a tie", () => {
		// Target 2026-06-16: 2026-06-01 and 2026-07-01 are both 15 days away.
		expect(nextExpectedAfter(plain(1), "2026-05-16")).toBe("2026-06-01");
	});

	it("takes any other schedule's first occurrence after the date, none past an installment", () => {
		const quarterly = schedule([monthly(10, 3)], { anchorDate: "2026-02-10" });

		expect(nextExpectedAfter(quarterly, "2026-05-12")).toBe("2026-08-10");
		expect(nextExpectedAfter(installment, "2026-03-05")).toBeNull();
	});
});

describe("dueFrom", () => {
	it("takes today when the expected day is today, else the next one", () => {
		expect(dueFrom(plain(21), TODAY)).toBe("2026-09-21");
		expect(dueFrom(plain(25), TODAY)).toBe("2026-09-25");
		expect(dueFrom(plain(20), TODAY)).toBe("2026-10-20");
		expect(dueFrom(plain(3), "2026-12-15")).toBe("2027-01-03");
	});

	it("clamps the 31st to the month's last day", () => {
		expect(dueFrom(plain(31), TODAY)).toBe("2026-09-30");
		expect(dueFrom(plain(31), "2026-09-30")).toBe("2026-09-30");
		expect(dueFrom(plain(31), "2026-10-31")).toBe("2026-10-31");
		expect(dueFrom(plain(30), "2027-01-31")).toBe("2027-02-28");
	});

	it("takes any other schedule's first occurrence from today on", () => {
		const quarterly = schedule([monthly(21, 3)], { anchorDate: "2026-03-21" });

		expect(dueFrom(quarterly, TODAY)).toBe("2026-09-21");
		expect(dueFrom(quarterly, "2026-09-22")).toBe("2026-12-21");
		expect(dueFrom(installment, TODAY)).toBeNull();
	});
});

describe("monthlyOn", () => {
	it("builds one monthly rule on the day", () => {
		expect(monthlyOn(12)).toEqual({ frequency: "monthly", interval: 1, dayOfMonth: 12 });
	});
});

describe("planEnd", () => {
	it("counts one cycle past the last payment, rounded up to whole days", () => {
		// 365.25 / 12 is 30.44 days: 31 a cycle, seven of them.
		expect(planEnd(schedule([monthly(5)]), "2026-10-05", 6)).toBe("2027-05-10");
		expect(planEnd(schedule([weekly(MONDAY)]), "2026-09-21", 2)).toBe("2026-10-12");
	});
});
