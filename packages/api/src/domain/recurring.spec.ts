import type { RecurringCandidate } from "./recurring.ts";

import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import {
	dayDistance,
	detectRecurring,
	expectedDay,
	isStale,
	nextDateFrom,
	nextExpectedDate,
} from "./recurring.ts";

const TODAY = "2026-09-21";

function row(date: string, overrides: Partial<RecurringCandidate> = {}): RecurringCandidate {
	return {
		accountId: "a1",
		date,
		amount: toMinorUnits(-1399),
		currency: "EUR",
		label: "NETFLIX.COM",
		merchantId: "netflix",
		transfer: null,
		...overrides,
	};
}

const rows = (dates: readonly string[], overrides: Partial<RecurringCandidate> = {}) =>
	dates.map((date) => row(date, overrides));

describe("dayDistance", () => {
	it("measures days on a 31-day circle", () => {
		expect(dayDistance(5, 10)).toBe(5);
		expect(dayDistance(30, 1)).toBe(2);
		expect(dayDistance(1, 31)).toBe(1);
		expect(dayDistance(1, 16)).toBe(15);
		expect(dayDistance(1, 17)).toBe(15);
	});
});

describe("expectedDay", () => {
	it("takes the median of an odd count", () => {
		expect(expectedDay([5, 5, 5])).toBe(5);
		expect(expectedDay([7, 3, 5])).toBe(5);
		expect(expectedDay([30, 31, 31])).toBe(31);
	});

	it("averages and rounds the two middle days of an even count", () => {
		expect(expectedDay([4, 5])).toBe(5);
		expect(expectedDay([3, 4, 6, 9])).toBe(5);
	});

	it("rotates across the month end to the arrangement of least span", () => {
		expect(expectedDay([30, 1, 2])).toBe(1);
		expect(expectedDay([29, 30, 1])).toBe(30);
		expect(expectedDay([31, 31, 1, 1])).toBe(1);
		expect(expectedDay([30, 31, 1, 2])).toBe(1);
	});
});

describe("detectRecurring", () => {
	it("finds a monthly bill", () => {
		expect(detectRecurring(rows(["2026-07-05", "2026-08-05", "2026-09-05"]), TODAY)).toEqual([
			{
				accountId: "a1",
				merchantId: "netflix",
				labelKey: null,
				label: "NETFLIX.COM",
				amount: -1399,
				currency: "EUR",
				expectedDayOfMonth: 5,
				lastOccurrenceDate: "2026-09-05",
				nextExpectedDate: "2026-10-05",
				occurrenceCount: 3,
			},
		]);
	});

	it("needs three rows", () => {
		expect(detectRecurring(rows(["2026-08-05", "2026-09-05"]), TODAY)).toEqual([]);
	});

	it("drops a group whose latest row is more than 45 days old", () => {
		expect(detectRecurring(rows(["2026-06-28", "2026-07-01", "2026-08-01"]), TODAY)).toEqual([]);
		expect(detectRecurring(rows(["2026-07-06", "2026-07-06", "2026-08-06"]), TODAY)).toEqual([]);
		expect(detectRecurring(rows(["2026-07-07", "2026-07-07", "2026-08-07"]), TODAY)).toHaveLength(
			1,
		);
	});

	it("reads three months back, today's day included", () => {
		expect(detectRecurring(rows(["2026-06-20", "2026-07-20", "2026-08-20"]), TODAY)).toEqual([]);
		expect(detectRecurring(rows(["2026-06-21", "2026-07-21", "2026-08-21"]), TODAY)).toMatchObject([
			{ occurrenceCount: 3 },
		]);
	});

	it("keeps the month end, clamped in a shorter month", () => {
		expect(detectRecurring(rows(["2026-06-30", "2026-07-31", "2026-08-31"]), TODAY)).toMatchObject([
			{ expectedDayOfMonth: 31, nextExpectedDate: "2026-09-30" },
		]);
	});

	it("clusters days across the month end", () => {
		expect(detectRecurring(rows(["2026-06-30", "2026-08-01", "2026-09-02"]), TODAY)).toMatchObject([
			{ expectedDayOfMonth: 1, nextExpectedDate: "2026-10-01" },
		]);
	});

	it("takes the expected day nearest to a month after a row that came early", () => {
		expect(detectRecurring(rows(["2026-07-01", "2026-08-02", "2026-08-31"]), TODAY)).toMatchObject([
			{ expectedDayOfMonth: 1, lastOccurrenceDate: "2026-08-31", nextExpectedDate: "2026-10-01" },
		]);
	});

	it("drops days spread over more than 5", () => {
		expect(detectRecurring(rows(["2026-07-05", "2026-08-15", "2026-09-15"]), TODAY)).toEqual([]);
		expect(detectRecurring(rows(["2026-07-05", "2026-08-10", "2026-09-10"]), TODAY)).toHaveLength(
			1,
		);
	});

	it("groups rows without merchant by their normalised label", () => {
		const noMerchant = { merchantId: null };

		expect(
			detectRecurring(
				[
					row("2026-07-10", { ...noMerchant, label: "PRLV EDF" }),
					row("2026-08-10", { ...noMerchant, label: "prlv  édf" }),
					row("2026-09-10", { ...noMerchant, label: "Prlv EDF " }),
				],
				TODAY,
			),
		).toMatchObject([{ merchantId: null, labelKey: "prlv edf", label: "Prlv EDF " }]);
	});

	it("keeps a merchant apart from rows with only the same label", () => {
		expect(
			detectRecurring(
				[
					row("2026-07-05"),
					row("2026-08-05", { merchantId: null, label: "netflix" }),
					row("2026-09-05", { merchantId: null, label: "netflix" }),
				],
				TODAY,
			),
		).toEqual([]);
	});

	it("keeps each amount apart", () => {
		const dates = ["2026-07-05", "2026-08-05", "2026-09-05"];

		expect(
			detectRecurring([...rows(dates), ...rows(dates, { amount: toMinorUnits(-1799) })], TODAY).map(
				(pattern) => pattern.amount,
			),
		).toEqual([-1399, -1799]);
	});

	it("keeps each account apart", () => {
		expect(
			detectRecurring(
				[row("2026-07-05"), row("2026-08-05", { accountId: "a2" }), row("2026-09-05")],
				TODAY,
			),
		).toEqual([]);
	});

	it("leaves transfers out, but counts a loan payment's outflow", () => {
		const dates = ["2026-07-05", "2026-08-05", "2026-09-05"];

		expect(detectRecurring(rows(dates, { transfer: { kind: "internal_move" } }), TODAY)).toEqual(
			[],
		);
		expect(
			detectRecurring(
				rows(dates, { amount: toMinorUnits(1399), transfer: { kind: "internal_move" } }),
				TODAY,
			),
		).toEqual([]);
		expect(
			detectRecurring(rows(dates, { transfer: { kind: "loan_payment" } }), TODAY),
		).toHaveLength(1);
	});

	it("counts income as well as expenses", () => {
		expect(
			detectRecurring(
				rows(["2026-07-28", "2026-08-28", "2026-09-01"], { amount: toMinorUnits(250_000) }),
				TODAY,
			),
		).toMatchObject([{ amount: 250_000, expectedDayOfMonth: 28 }]);
	});

	it("takes the label and date of the latest row whatever the input order", () => {
		expect(
			detectRecurring(
				[
					row("2026-09-05", { label: "NETFLIX SEPT" }),
					row("2026-07-05"),
					row("2026-08-05"),
					row("2026-07-05"),
				],
				TODAY,
			),
		).toMatchObject([
			{ label: "NETFLIX SEPT", lastOccurrenceDate: "2026-09-05", occurrenceCount: 4 },
		]);
	});
});

describe("nextExpectedDate", () => {
	it("takes the expected day of the next month when the row came on time", () => {
		expect(nextExpectedDate("2026-09-05", 5)).toBe("2026-10-05");
		expect(nextExpectedDate("2026-09-03", 5)).toBe("2026-10-05");
		expect(nextExpectedDate("2026-09-07", 5)).toBe("2026-10-05");
	});

	it("moves a month on for a row that came early across the month end", () => {
		expect(nextExpectedDate("2026-08-31", 1)).toBe("2026-10-01");
		expect(nextExpectedDate("2026-08-30", 2)).toBe("2026-10-02");
	});

	it("moves a month back for a row that came late across the month end", () => {
		expect(nextExpectedDate("2026-09-02", 30)).toBe("2026-09-30");
		expect(nextExpectedDate("2026-09-01", 31)).toBe("2026-09-30");
	});

	it("clamps the month end to a shorter month", () => {
		expect(nextExpectedDate("2026-01-31", 31)).toBe("2026-02-28");
		expect(nextExpectedDate("2026-08-31", 31)).toBe("2026-09-30");
	});

	it("keeps the target's month on a tie", () => {
		// Target 2026-06-16: 2026-06-01 and 2026-07-01 are both 15 days away.
		expect(nextExpectedDate("2026-05-16", 1)).toBe("2026-06-01");
	});
});

describe("nextDateFrom", () => {
	it("takes today when the expected day is today", () => {
		expect(nextDateFrom(TODAY, 21)).toBe("2026-09-21");
	});

	it("takes this month when the expected day is still ahead", () => {
		expect(nextDateFrom(TODAY, 25)).toBe("2026-09-25");
	});

	it("takes next month when the expected day has passed", () => {
		expect(nextDateFrom(TODAY, 20)).toBe("2026-10-20");
		expect(nextDateFrom("2026-12-15", 3)).toBe("2027-01-03");
	});

	it("clamps the 31st to the month's last day", () => {
		expect(nextDateFrom(TODAY, 31)).toBe("2026-09-30");
		expect(nextDateFrom("2026-09-30", 31)).toBe("2026-09-30");
		expect(nextDateFrom("2026-10-31", 31)).toBe("2026-10-31");
		expect(nextDateFrom("2027-01-31", 30)).toBe("2027-02-28");
	});
});

describe("isStale", () => {
	it("marks a pattern stale more than two months after its last row", () => {
		expect(isStale("2026-07-15", TODAY)).toBe(true);
		expect(isStale("2026-07-20", TODAY)).toBe(true);
		expect(isStale("2026-07-21", TODAY)).toBe(false);
		expect(isStale("2026-09-10", TODAY)).toBe(false);
	});
});
