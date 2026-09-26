import type { RecurringCandidate, StoredSeries } from "./recurring.ts";

import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import {
	currentNextDate,
	dayDistance,
	detectRecurring,
	expectedDay,
	isStale,
	nextDateFrom,
	nextExpectedDate,
	occurrencesOf,
	refreshSeries,
	rekey,
	seriesKeyOf,
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

function series(overrides: Partial<StoredSeries> = {}): StoredSeries {
	return {
		id: "s1",
		accountId: "a1",
		merchantId: null,
		labelKey: "prlv netflix",
		label: "PRLV NETFLIX",
		amount: toMinorUnits(-1399),
		currency: "EUR",
		status: "detected",
		manual: false,
		expectedDayOfMonth: 5,
		lastOccurrenceDate: "2026-09-05",
		nextExpectedDate: "2026-10-05",
		occurrenceCount: 3,
		...overrides,
	};
}

describe("seriesKeyOf", () => {
	it("keys by merchant, else by normalised label", () => {
		expect(seriesKeyOf(row("2026-09-05"))).toEqual({ merchantId: "netflix", labelKey: null });
		expect(seriesKeyOf(row("2026-09-05", { merchantId: null, label: " Prlv  NETFLIX" }))).toEqual({
			merchantId: null,
			labelKey: "prlv netflix",
		});
	});
});

describe("rekey", () => {
	it("moves a series to the one other key its latest transaction carries, keeping id and status", () => {
		const moved = rekey(
			[series({ status: "dismissed" })],
			[row("2026-09-05", { label: "Netflix Sept" }), row("2026-08-05", { merchantId: null })],
			TODAY,
		);

		expect(moved.steps).toEqual([
			{ kind: "move", id: "s1", merchantId: "netflix", labelKey: null, label: "Netflix Sept" },
		]);
		expect(moved.stored).toEqual([
			series({ status: "dismissed", merchantId: "netflix", labelKey: null, label: "Netflix Sept" }),
		]);
	});

	it("takes the label of the last transaction of the target key", () => {
		const noMerchant = { merchantId: null };

		expect(
			rekey(
				[series()],
				[
					row("2026-09-05", { ...noMerchant, label: "NETFLIX A" }),
					row("2026-09-05", { ...noMerchant, label: "netflix  a" }),
				],
				TODAY,
			).steps,
		).toEqual([
			{ kind: "move", id: "s1", merchantId: null, labelKey: "netflix a", label: "netflix  a" },
		]);
	});

	it("stays while a transaction of its own key remains on its last date", () => {
		expect(
			rekey(
				[series()],
				[row("2026-09-05"), row("2026-09-05", { merchantId: null, label: "PRLV NETFLIX" })],
				TODAY,
			),
		).toEqual({ steps: [], stored: [series()] });
	});

	it("stays while an older row of its window keeps its key", () => {
		const noMerchant = { merchantId: null, label: "PRLV NETFLIX" };

		expect(
			rekey(
				[series()],
				[row("2026-07-05", noMerchant), row("2026-08-05", noMerchant), row("2026-09-05")],
				TODAY,
			).steps,
		).toEqual([]);
		// Out of its three months, an old row no longer holds it.
		expect(
			rekey([series()], [row("2026-06-05", noMerchant), row("2026-09-05")], TODAY).steps,
		).toHaveLength(1);
	});

	it("stays when its last date carries two other keys, or none", () => {
		expect(
			rekey(
				[series()],
				[row("2026-09-05"), row("2026-09-05", { merchantId: null, label: "NETFLIX" })],
				TODAY,
			).steps,
		).toEqual([]);
		expect(rekey([series()], [row("2026-09-04")], TODAY).steps).toEqual([]);
	});

	it("reads only its account, amount and currency, and leaves transfers out", () => {
		const others = [
			row("2026-09-05", { accountId: "a2" }),
			row("2026-09-05", { amount: toMinorUnits(-1599) }),
			row("2026-09-05", { currency: "USD" }),
			row("2026-09-05", { transfer: { kind: "internal_move" } }),
		];

		expect(rekey([series()], others, TODAY).steps).toEqual([]);
	});

	it("deletes a detected holder of the new key and moves", () => {
		const holder = series({ id: "s2", merchantId: "netflix", labelKey: null, status: "detected" });

		expect(rekey([series({ status: "confirmed" }), holder], [row("2026-09-05")], TODAY)).toEqual({
			steps: [
				{ kind: "delete", id: "s2" },
				{ kind: "move", id: "s1", merchantId: "netflix", labelKey: null, label: "NETFLIX.COM" },
			],
			stored: [
				series({
					status: "confirmed",
					merchantId: "netflix",
					labelKey: null,
					label: "NETFLIX.COM",
				}),
			],
		});
	});

	it("deletes the moving series when the holder of the new key is not detected", () => {
		const holder = series({ id: "s2", merchantId: "netflix", labelKey: null, status: "confirmed" });

		expect(rekey([series(), holder], [row("2026-09-05")], TODAY)).toEqual({
			steps: [{ kind: "delete", id: "s1" }],
			stored: [holder],
		});
	});

	it("keeps a holder of another amount or account", () => {
		const others = [
			series({ id: "s2", merchantId: "netflix", labelKey: null, amount: toMinorUnits(-1599) }),
			series({ id: "s3", merchantId: "netflix", labelKey: null, accountId: "a2" }),
		];

		expect(rekey([series(), ...others], [row("2026-09-05")], TODAY).steps).toEqual([
			{ kind: "move", id: "s1", merchantId: "netflix", labelKey: null, label: "NETFLIX.COM" },
		]);
	});
});

describe("occurrencesOf", () => {
	const noMerchant = { merchantId: null, label: "PRLV NETFLIX" };

	it("reads three months back for a detected series, six for a confirmed or manual one", () => {
		const candidates = ["2026-03-04", "2026-04-05", "2026-06-04", "2026-06-05", "2026-09-05"].map(
			(date) => row(date, noMerchant),
		);
		const datesOf = (stored: StoredSeries) =>
			occurrencesOf(stored, candidates, "2026-09-05").map((found) => found.date);

		expect(datesOf(series())).toEqual(["2026-06-05", "2026-09-05"]);
		expect(datesOf(series({ status: "confirmed" }))).toEqual([
			"2026-04-05",
			"2026-06-04",
			"2026-06-05",
			"2026-09-05",
		]);
		expect(datesOf(series({ manual: true }))).toHaveLength(4);
	});

	it("keeps transactions within 5 days of the expected day, across the month end", () => {
		const candidates = ["2026-08-10", "2026-08-11", "2026-08-27", "2026-08-26"].map((date) =>
			row(date, noMerchant),
		);

		expect(
			occurrencesOf(series({ expectedDayOfMonth: 5 }), candidates, TODAY).map(
				(found) => found.date,
			),
		).toEqual(["2026-08-10"]);
		expect(
			occurrencesOf(series({ expectedDayOfMonth: 1 }), candidates, TODAY).map(
				(found) => found.date,
			),
		).toEqual(["2026-08-27"]);
	});

	it("keeps only the series' account, key, amount and currency, transfers left out", () => {
		const candidates = [
			row("2026-09-05"),
			row("2026-09-05", { ...noMerchant, accountId: "a2" }),
			row("2026-09-05", { ...noMerchant, amount: toMinorUnits(-1599) }),
			row("2026-09-05", { ...noMerchant, currency: "USD" }),
			row("2026-09-05", { ...noMerchant, transfer: { kind: "internal_move" } }),
		];

		expect(occurrencesOf(series(), candidates, TODAY)).toEqual([]);
	});

	it("orders them by date, same days in the caller's order", () => {
		const candidates = [
			row("2026-09-05", { ...noMerchant, label: "prlv netflix" }),
			row("2026-08-05", noMerchant),
			row("2026-09-05", { ...noMerchant, label: "Prlv Netflix" }),
		];

		expect(occurrencesOf(series(), candidates, TODAY).map((found) => found.label)).toEqual([
			"PRLV NETFLIX",
			"prlv netflix",
			"Prlv Netflix",
		]);
	});
});

describe("currentNextDate", () => {
	it("keeps a next date from today on, and moves a past one", () => {
		expect(currentNextDate("2026-09-21", 21, TODAY)).toBe("2026-09-21");
		expect(currentNextDate("2026-10-05", 5, TODAY)).toBe("2026-10-05");
		expect(currentNextDate("2026-08-15", 15, TODAY)).toBe("2026-10-15");
	});
});

describe("refreshSeries", () => {
	const noMerchant = { merchantId: null, label: "PRLV NETFLIX" };

	it("rewrites count, latest date and label from the current transactions", () => {
		expect(
			refreshSeries(
				series({ occurrenceCount: 5 }),
				[
					row("2026-08-05", noMerchant),
					row("2026-09-04", { ...noMerchant, label: "prlv netflix" }),
				],
				TODAY,
			),
		).toEqual({
			kind: "update",
			label: "prlv netflix",
			lastOccurrenceDate: "2026-09-04",
			nextExpectedDate: "2026-10-05",
			occurrenceCount: 2,
		});
	});

	it("moves the next date of a confirmed or manual series from today on, not a detected one's", () => {
		const candidates = [row("2026-07-15", noMerchant)];
		const late = { expectedDayOfMonth: 15, lastOccurrenceDate: "2026-07-15" };

		expect(
			refreshSeries(series({ ...late, status: "confirmed" }), candidates, TODAY),
		).toMatchObject({ nextExpectedDate: "2026-10-15", occurrenceCount: 1 });
		expect(refreshSeries(series({ ...late, manual: true }), candidates, TODAY)).toMatchObject({
			nextExpectedDate: "2026-10-15",
		});
		expect(refreshSeries(series(late), candidates, TODAY)).toMatchObject({
			nextExpectedDate: "2026-08-15",
		});
	});

	it("deletes a detected series that lost every row of its window", () => {
		expect(refreshSeries(series(), [], TODAY)).toEqual({ kind: "delete" });
		expect(refreshSeries(series({ lastOccurrenceDate: "2026-06-21" }), [], TODAY)).toEqual({
			kind: "delete",
		});
	});

	it("keeps a detected series last seen before its window, count 0", () => {
		expect(
			refreshSeries(
				series({ lastOccurrenceDate: "2026-06-20", nextExpectedDate: "2026-07-20" }),
				[],
				TODAY,
			),
		).toEqual({
			kind: "update",
			label: "PRLV NETFLIX",
			lastOccurrenceDate: "2026-06-20",
			nextExpectedDate: "2026-07-20",
			occurrenceCount: 0,
		});
	});

	it("keeps any other series with no row left, count 0, a confirmed one due from today on", () => {
		expect(refreshSeries(series({ status: "inactive" }), [], TODAY)).toMatchObject({
			kind: "update",
			lastOccurrenceDate: "2026-09-05",
			nextExpectedDate: "2026-10-05",
			occurrenceCount: 0,
		});
		expect(
			refreshSeries(
				series({
					status: "confirmed",
					lastOccurrenceDate: "2026-07-05",
					nextExpectedDate: "2026-08-05",
				}),
				[],
				TODAY,
			),
		).toMatchObject({
			lastOccurrenceDate: "2026-07-05",
			nextExpectedDate: "2026-10-05",
			occurrenceCount: 0,
		});
	});
});
