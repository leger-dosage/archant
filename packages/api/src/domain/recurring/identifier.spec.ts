import type { ClaimableSeries, RecurringCandidate, RecurringPattern } from "./identifier.ts";

import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import {
	claimOf,
	clusterByAmount,
	dayDistance,
	detectRecurring,
	expectedDay,
	roundedMean,
	seriesKeyOf,
	withinBand,
	withinMeanTolerance,
} from "./identifier.ts";

const TODAY = "2026-09-21";

const m = toMinorUnits;

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

const priced = (entries: readonly (readonly [string, number])[]) =>
	entries.map(([date, amount]) => row(date, { amount: toMinorUnits(amount) }));

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
	it("takes a single day as it is", () => {
		expect(expectedDay([17])).toBe(17);
	});

	it("takes the median of an odd count", () => {
		expect(expectedDay([5, 5, 5])).toBe(5);
		expect(expectedDay([7, 3, 5])).toBe(5);
		expect(expectedDay([30, 31, 31])).toBe(31);
	});

	it("averages the two middle days of an even count, rounding half away from zero", () => {
		expect(expectedDay([4, 5])).toBe(5);
		expect(expectedDay([3, 4, 6, 9])).toBe(5);
		expect(expectedDay([6, 10, 7, 5])).toBe(7);
	});

	it("rotates across the month end to the arrangement of least span", () => {
		expect(expectedDay([30, 1, 2])).toBe(1);
		expect(expectedDay([29, 30, 1])).toBe(30);
		expect(expectedDay([31, 31, 1, 1])).toBe(1);
		expect(expectedDay([30, 31, 1, 2])).toBe(1);
		expect(expectedDay([30, 31, 1])).toBe(31);
	});

	it("keeps the lowest pivot on a tie of spans", () => {
		// 1 and 16 span 15 from pivot 0 and from pivot 16: pivot 0 wins, and
		// the mean of 0 and 15 rounds to 8, the 9th.
		expect(expectedDay([1, 16])).toBe(9);
		// 1 and 17 span 16 from pivot 0 and 15 from pivot 1 on: pivot 1 wins.
		expect(expectedDay([1, 17])).toBe(25);
	});
});

describe("withinMeanTolerance", () => {
	it("keeps an amount within 7.5 % of the mean, the bound included", () => {
		expect(withinMeanTolerance(m(1000), 1, m(1075))).toBe(true);
		expect(withinMeanTolerance(m(1000), 1, m(1076))).toBe(false);
		expect(withinMeanTolerance(m(1000), 1, m(925))).toBe(true);
		expect(withinMeanTolerance(m(1000), 1, m(924))).toBe(false);
		expect(withinMeanTolerance(m(-3000), 3, m(-1075))).toBe(true);
		expect(withinMeanTolerance(m(-3000), 3, m(-1076))).toBe(false);
	});
});

describe("withinBand", () => {
	it("keeps half to twice the anchor, both included, on its side of zero", () => {
		expect(withinBand(m(-500), m(-1000))).toBe(true);
		expect(withinBand(m(-2000), m(-1000))).toBe(true);
		expect(withinBand(m(-499), m(-1000))).toBe(false);
		expect(withinBand(m(-2001), m(-1000))).toBe(false);
		expect(withinBand(m(1000), m(-1000))).toBe(false);
		expect(withinBand(m(1500), m(1000))).toBe(true);
	});

	it("takes only zero for a zero anchor", () => {
		expect(withinBand(m(0), m(0))).toBe(true);
		expect(withinBand(m(1), m(0))).toBe(false);
	});
});

describe("roundedMean", () => {
	it("rounds half away from zero", () => {
		expect(roundedMean(m(5), 2)).toBe(3);
		expect(roundedMean(m(-5), 2)).toBe(-3);
		expect(roundedMean(m(-171_387), 3)).toBe(-57_129);
		expect(roundedMean(m(7), 3)).toBe(2);
	});
});

describe("clusterByAmount", () => {
	it("joins a row within 7.5 % of the running mean, else starts a cluster", () => {
		expect(clusterByAmount([{ amount: m(-1075) }, { amount: m(-1000) }])).toEqual([
			[{ amount: -1000 }, { amount: -1075 }],
		]);
		expect(clusterByAmount([{ amount: m(-1076) }, { amount: m(-1000) }])).toEqual([
			[{ amount: -1000 }],
			[{ amount: -1076 }],
		]);
		// An income sorts largest first, as Sure's negative inflows.
		expect(clusterByAmount([{ amount: m(1000) }, { amount: m(1100) }])).toEqual([
			[{ amount: 1100 }],
			[{ amount: 1000 }],
		]);
	});

	it("orders an expense by magnitude, as Sure's positive amounts", () => {
		expect(
			clusterByAmount([{ amount: m(-4000) }, { amount: m(-1000) }, { amount: m(-2000) }]).map(
				(cluster) => cluster.map((entry) => entry.amount),
			),
		).toEqual([[-1000], [-2000], [-4000]]);
	});

	it("compares with the mean, so small steps never chain far", () => {
		const amounts = [1000, 1070, 1140, 1210].map((amount) => ({ amount: m(-amount) }));

		expect(clusterByAmount(amounts).map((cluster) => cluster.map((entry) => entry.amount))).toEqual(
			[
				[-1000, -1070],
				[-1140, -1210],
			],
		);
	});
});

describe("detectRecurring", () => {
	it("finds a monthly bill with its band and its rows", () => {
		const found = rows(["2026-07-05", "2026-08-05", "2026-09-05"]);

		expect(detectRecurring(found, TODAY)).toEqual([
			{
				accountId: "a1",
				merchantId: "netflix",
				labelKey: null,
				label: "NETFLIX.COM",
				amount: -1399,
				expectedAmountMin: -1399,
				expectedAmountMax: -1399,
				expectedAmountAvg: -1399,
				amountTotal: -4197,
				currency: "EUR",
				expectedDayOfMonth: 5,
				lastOccurrenceDate: "2026-09-05",
				occurrenceCount: 3,
				rows: found,
				latest: found[2],
			},
		]);
	});

	it("finds the mortgage whose amount moves by a few cents", () => {
		expect(
			detectRecurring(
				priced([
					["2026-07-07", -57_129],
					["2026-08-07", -57_136],
					["2026-09-08", -57_122],
				]),
				"2026-09-15",
			),
		).toMatchObject([
			{
				amount: -57_122,
				expectedAmountMin: -57_136,
				expectedAmountMax: -57_122,
				expectedAmountAvg: -57_129,
				expectedDayOfMonth: 7,
				occurrenceCount: 3,
			},
		]);
	});

	it("misses the mortgage once a day lies 3 from the expected one", () => {
		expect(
			detectRecurring(
				priced([
					["2026-07-06", -57_129],
					["2026-08-10", -57_136],
					["2026-09-07", -57_122],
					["2026-10-05", -57_129],
				]),
				"2026-10-06",
			),
		).toEqual([]);
	});

	it("keeps a price rise in one series at the new price", () => {
		expect(
			detectRecurring(
				priced([
					["2026-07-05", -999],
					["2026-08-05", -999],
					["2026-09-05", -1049],
				]),
				TODAY,
			),
		).toMatchObject([{ amount: -1049, expectedAmountMin: -1049, expectedAmountMax: -999 }]);
	});

	it("keeps three tiers of one merchant apart, in ascending amount", () => {
		const dates = ["2026-07-05", "2026-08-05", "2026-09-05"];

		expect(
			detectRecurring(
				[
					...rows(dates, { amount: toMinorUnits(-4000) }),
					...rows(dates, { amount: toMinorUnits(-1000) }),
					...rows(dates, { amount: toMinorUnits(-2000) }),
				],
				TODAY,
			).map((pattern) => pattern.amount),
		).toEqual([-1000, -2000, -4000]);
	});

	it("needs three rows, or as many as asked", () => {
		expect(detectRecurring(rows(["2026-08-05", "2026-09-05"]), TODAY)).toEqual([]);
		expect(detectRecurring(rows(["2026-08-05", "2026-09-05"]), TODAY, 2)).toMatchObject([
			{ occurrenceCount: 2, lastOccurrenceDate: "2026-09-05" },
		]);
	});

	it("drops a cluster whose latest row is more than 45 days old", () => {
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

	it("keeps the month end", () => {
		expect(detectRecurring(rows(["2026-06-30", "2026-07-31", "2026-08-31"]), TODAY)).toMatchObject([
			{ expectedDayOfMonth: 31 },
		]);
	});

	it("clusters days across 30, 31 and 1", () => {
		expect(detectRecurring(rows(["2026-06-30", "2026-08-01", "2026-09-02"]), TODAY)).toMatchObject([
			{ expectedDayOfMonth: 1 },
		]);
		expect(detectRecurring(rows(["2026-06-30", "2026-07-31", "2026-09-01"]), TODAY)).toMatchObject([
			{ expectedDayOfMonth: 31 },
		]);
	});

	it("drops a cluster with a day more than 2 from the expected one", () => {
		expect(detectRecurring(rows(["2026-07-05", "2026-08-08", "2026-09-05"]), TODAY)).toEqual([]);
		expect(detectRecurring(rows(["2026-07-05", "2026-08-07", "2026-09-05"]), TODAY)).toHaveLength(
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

	it("keeps each account and currency apart", () => {
		expect(
			detectRecurring(
				[row("2026-07-05"), row("2026-08-05", { accountId: "a2" }), row("2026-09-05")],
				TODAY,
			),
		).toEqual([]);
		expect(
			detectRecurring(
				[row("2026-07-05"), row("2026-08-05", { currency: "USD" }), row("2026-09-05")],
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
				rows(["2026-06-28", "2026-07-28", "2026-08-30"], { amount: toMinorUnits(250_000) }),
				TODAY,
			),
		).toMatchObject([{ amount: 250_000, expectedDayOfMonth: 28 }]);
	});

	it("takes the label, amount and date of the latest row whatever the input order", () => {
		expect(
			detectRecurring(
				[
					row("2026-09-05", { label: "NETFLIX SEPT", amount: toMinorUnits(-1400) }),
					row("2026-07-05"),
					row("2026-08-05"),
					row("2026-07-05"),
				],
				TODAY,
			),
		).toMatchObject([
			{
				label: "NETFLIX SEPT",
				amount: -1400,
				lastOccurrenceDate: "2026-09-05",
				occurrenceCount: 4,
			},
		]);
	});
});

describe("seriesKeyOf", () => {
	it("keys by merchant, else by normalised label", () => {
		expect(seriesKeyOf(row("2026-09-05"))).toEqual({ merchantId: "netflix", labelKey: null });
		expect(seriesKeyOf(row("2026-09-05", { merchantId: null, label: " Prlv  NETFLIX" }))).toEqual({
			merchantId: null,
			labelKey: "prlv netflix",
		});
	});
});

/** The pattern of three monthly rows of `amounts`. */
const pattern = (amounts: readonly number[]): RecurringPattern =>
	detectRecurring(
		priced(amounts.map((amount, index) => [`2026-0${7 + index}-05`, amount] as const)),
		TODAY,
	)[0]!;

const stored = (
	id: string,
	amount: number,
	overrides: Partial<ClaimableSeries> = {},
): ClaimableSeries & { id: string } => ({
	id,
	accountId: "a1",
	merchantId: "netflix",
	labelKey: null,
	currency: "EUR",
	amount: m(amount),
	...overrides,
});

describe("claimOf", () => {
	it("takes the series within 7.5 % of the mean nearest to it", () => {
		const found = pattern([-1000, -1000, -1000]);

		expect(claimOf(found, [stored("s1", -1075), stored("s2", -980)])?.id).toBe("s2");
		expect(claimOf(found, [stored("s1", -1076), stored("s2", -924)])).toBeUndefined();
	});

	it("keeps the first of two series equally near", () => {
		expect(
			claimOf(pattern([-1000, -1000, -1000]), [stored("s1", -1050), stored("s2", -950)])?.id,
		).toBe("s1");
	});

	it("compares with the exact mean, not the rounded one", () => {
		// Mean −1000.33…, rounded −1000: −925 lies within 7.5 % of the rounded
		// mean, not of the exact one.
		const found = pattern([-1000, -1000, -1001]);

		expect(claimOf(found, [stored("s1", -925)])).toBeUndefined();
		expect(claimOf(found, [stored("s1", -926)])?.id).toBe("s1");
	});

	it("reads only the pattern's account, key and currency", () => {
		const found = pattern([-1000, -1000, -1000]);

		expect(
			claimOf(found, [
				stored("s1", -1000, { accountId: "a2" }),
				stored("s2", -1000, { merchantId: null, labelKey: "netflix" }),
				stored("s3", -1000, { currency: "USD" }),
			]),
		).toBeUndefined();
	});
});
