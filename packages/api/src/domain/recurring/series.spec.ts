import type { RecurringCandidate } from "./identifier.ts";
import type { StoredSeries } from "./series.ts";

import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import {
	cleanerSteps,
	currentNextDate,
	nextDateFrom,
	nextExpectedDate,
	occurrencesOf,
	refreshSeries,
	rekey,
	staleBefore,
} from "./series.ts";

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

function series(overrides: Partial<StoredSeries> = {}): StoredSeries {
	return {
		id: "s1",
		accountId: "a1",
		merchantId: null,
		labelKey: "prlv netflix",
		label: "PRLV NETFLIX",
		amount: toMinorUnits(-1399),
		currency: "EUR",
		status: "suggested",
		manual: false,
		dedupScope: "",
		expectedAmountMin: null,
		expectedAmountMax: null,
		expectedAmountAvg: null,
		expectedDayOfMonth: 5,
		lastOccurrenceDate: "2026-09-05",
		nextExpectedDate: "2026-10-05",
		occurrenceCount: 3,
		...overrides,
	};
}

describe("rekey", () => {
	it("moves a series to the one other key its latest transaction carries, keeping id and status", () => {
		const moved = rekey(
			[series({ status: "ended" })],
			[row("2026-09-05", { label: "Netflix Sept" }), row("2026-08-05", { merchantId: null })],
			TODAY,
		);

		expect(moved.steps).toEqual([
			{ kind: "move", id: "s1", merchantId: "netflix", labelKey: null, label: "Netflix Sept" },
		]);
		expect(moved.stored).toEqual([
			series({ status: "ended", merchantId: "netflix", labelKey: null, label: "Netflix Sept" }),
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

	it("reads only its account, currency and half to twice its amount, and leaves transfers out", () => {
		const others = [
			row("2026-09-05", { accountId: "a2" }),
			row("2026-09-05", { amount: toMinorUnits(-2799) }),
			row("2026-09-05", { amount: toMinorUnits(-699) }),
			row("2026-09-05", { currency: "USD" }),
			row("2026-09-05", { transfer: { kind: "internal_move" } }),
		];

		expect(rekey([series()], others, TODAY).steps).toEqual([]);
		expect(
			rekey([series()], [row("2026-09-05", { amount: toMinorUnits(-2798) })], TODAY).steps,
		).toEqual([
			{ kind: "move", id: "s1", merchantId: "netflix", labelKey: null, label: "NETFLIX.COM" },
		]);
	});

	it("deletes a suggested holder of the new key and moves", () => {
		const holder = series({ id: "s2", merchantId: "netflix", labelKey: null, status: "suggested" });

		expect(rekey([series({ status: "active" }), holder], [row("2026-09-05")], TODAY)).toEqual({
			steps: [
				{ kind: "delete", id: "s2" },
				{ kind: "move", id: "s1", merchantId: "netflix", labelKey: null, label: "NETFLIX.COM" },
			],
			stored: [
				series({
					status: "active",
					merchantId: "netflix",
					labelKey: null,
					label: "NETFLIX.COM",
				}),
			],
		});
	});

	it("deletes the moving series when the holder of the new key is not suggested", () => {
		const holder = series({ id: "s2", merchantId: "netflix", labelKey: null, status: "active" });

		expect(rekey([series(), holder], [row("2026-09-05")], TODAY)).toEqual({
			steps: [{ kind: "delete", id: "s1" }],
			stored: [holder],
		});
	});

	it("keeps a holder of another amount, account, currency or dedup scope", () => {
		const others = [
			series({ id: "s2", merchantId: "netflix", labelKey: null, amount: toMinorUnits(-1599) }),
			series({ id: "s3", merchantId: "netflix", labelKey: null, accountId: "a2" }),
			series({ id: "s4", merchantId: "netflix", labelKey: null, currency: "USD" }),
			series({ id: "s5", merchantId: "netflix", labelKey: null, dedupScope: "-1400" }),
		];

		expect(rekey([series(), ...others], [row("2026-09-05")], TODAY).steps).toEqual([
			{ kind: "move", id: "s1", merchantId: "netflix", labelKey: null, label: "NETFLIX.COM" },
		]);
	});
});

describe("occurrencesOf", () => {
	const noMerchant = { merchantId: null, label: "PRLV NETFLIX" };

	it("reads three months back for a suggested series, six for an active or manual one", () => {
		const candidates = ["2026-03-04", "2026-04-05", "2026-06-04", "2026-06-05", "2026-09-05"].map(
			(date) => row(date, noMerchant),
		);
		const datesOf = (stored: StoredSeries) =>
			occurrencesOf(stored, candidates, "2026-09-05").map((found) => found.date);

		expect(datesOf(series())).toEqual(["2026-06-05", "2026-09-05"]);
		expect(datesOf(series({ status: "active" }))).toEqual([
			"2026-04-05",
			"2026-06-04",
			"2026-06-05",
			"2026-09-05",
		]);
		expect(datesOf(series({ manual: true }))).toHaveLength(4);
	});

	it("keeps transactions within 2 days of the expected day, across the month end", () => {
		const candidates = ["2026-08-07", "2026-08-08", "2026-08-30", "2026-08-29"].map((date) =>
			row(date, noMerchant),
		);

		expect(
			occurrencesOf(series({ expectedDayOfMonth: 5 }), candidates, TODAY).map(
				(found) => found.date,
			),
		).toEqual(["2026-08-07"]);
		expect(
			occurrencesOf(series({ expectedDayOfMonth: 1 }), candidates, TODAY).map(
				(found) => found.date,
			),
		).toEqual(["2026-08-30"]);
	});

	it("keeps half to twice the series' amount, both included", () => {
		const candidates = [-699, -700, -2798, -2799, 1399].map((amount) =>
			row("2026-09-05", { ...noMerchant, amount: toMinorUnits(amount) }),
		);

		expect(
			occurrencesOf(series({ amount: toMinorUnits(-1399) }), candidates, TODAY).map(
				(found) => found.amount,
			),
		).toEqual([-700, -2798]);
	});

	it("keeps only the series' account, key and currency, transfers left out", () => {
		const candidates = [
			row("2026-09-05"),
			row("2026-09-05", { ...noMerchant, accountId: "a2" }),
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
			band: null,
		});
	});

	it("takes the band of an active manual series from six months of its transactions", () => {
		const candidates = [
			row("2026-04-05", { ...noMerchant, amount: toMinorUnits(-1300) }),
			row("2026-03-05", { ...noMerchant, amount: toMinorUnits(-1000) }),
			row("2026-08-06", { ...noMerchant, amount: toMinorUnits(-1500) }),
			row("2026-09-05", { ...noMerchant, amount: toMinorUnits(-2798) }),
			row("2026-09-05", { ...noMerchant, amount: toMinorUnits(-2799) }),
			row("2026-07-08", { ...noMerchant, amount: toMinorUnits(-1399) }),
		];

		expect(
			refreshSeries(series({ status: "active", manual: true }), candidates, TODAY),
		).toMatchObject({
			lastOccurrenceDate: "2026-09-05",
			occurrenceCount: 3,
			band: { expectedAmountMin: -2798, expectedAmountMax: -1300, expectedAmountAvg: -1866 },
		});
		expect(refreshSeries(series({ status: "active" }), candidates, TODAY)).toMatchObject({
			band: null,
		});
		expect(
			refreshSeries(series({ status: "inactive", manual: true }), candidates, TODAY),
		).toMatchObject({ band: null });
	});

	it("moves the next date of an active or manual series from today on, not a suggested one's", () => {
		const candidates = [row("2026-07-15", noMerchant)];
		const late = { expectedDayOfMonth: 15, lastOccurrenceDate: "2026-07-15" };

		expect(refreshSeries(series({ ...late, status: "active" }), candidates, TODAY)).toMatchObject({
			nextExpectedDate: "2026-10-15",
			occurrenceCount: 1,
		});
		expect(refreshSeries(series({ ...late, manual: true }), candidates, TODAY)).toMatchObject({
			nextExpectedDate: "2026-10-15",
		});
		expect(refreshSeries(series(late), candidates, TODAY)).toMatchObject({
			nextExpectedDate: "2026-08-15",
		});
	});

	it("deletes a suggested series with no row left in its window, whatever its last date", () => {
		expect(refreshSeries(series(), [], TODAY)).toEqual({ kind: "delete" });
		expect(
			refreshSeries(
				series({ lastOccurrenceDate: "2026-06-20" }),
				[row("2026-06-05", noMerchant)],
				TODAY,
			),
		).toEqual({ kind: "delete" });
	});

	it("keeps any other series with no row left, count 0, an active one due from today on", () => {
		expect(refreshSeries(series({ status: "inactive" }), [], TODAY)).toEqual({
			kind: "update",
			label: "PRLV NETFLIX",
			lastOccurrenceDate: "2026-09-05",
			nextExpectedDate: "2026-10-05",
			occurrenceCount: 0,
			band: null,
		});
		expect(
			refreshSeries(
				series({
					status: "active",
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

describe("staleBefore", () => {
	it("takes the earlier of two months and two monthly cycles, six months for a manual series", () => {
		// Two months back is 2026-07-21, 61 days back 2026-07-22.
		expect(staleBefore({ manual: false }, TODAY)).toBe("2026-07-21");
		// 61 days before 2026-10-31 is 2026-08-31, two months 2026-08-31 too.
		expect(staleBefore({ manual: false }, "2026-10-31")).toBe("2026-08-31");
		// Two months before 2026-03-31 is 2026-01-31, 61 days back 2026-01-29.
		expect(staleBefore({ manual: false }, "2026-03-31")).toBe("2026-01-29");
		expect(staleBefore({ manual: true }, TODAY)).toBe("2026-03-21");
	});
});

const active = (overrides: Partial<StoredSeries> = {}) =>
	series({ status: "active", ...overrides });

describe("cleanerSteps", () => {
	const noMerchant = { merchantId: null, label: "PRLV NETFLIX" };

	it("marks an active series inactive once last seen before the threshold, not on it", () => {
		expect(
			cleanerSteps(
				[
					active({ id: "s1", lastOccurrenceDate: "2026-07-20" }),
					active({ id: "s2", lastOccurrenceDate: "2026-07-21" }),
				],
				[],
				TODAY,
			),
		).toEqual({ inactive: ["s1"], deleted: [] });
	});

	it("gives a manual series six months", () => {
		expect(
			cleanerSteps(
				[
					active({ id: "s1", manual: true, lastOccurrenceDate: "2026-03-20" }),
					active({ id: "s2", manual: true, lastOccurrenceDate: "2026-03-21" }),
				],
				[],
				TODAY,
			).inactive,
		).toEqual(["s1"]);
	});

	it("keeps one with a matching transaction since the threshold", () => {
		const stale = active({ lastOccurrenceDate: "2026-06-05" });

		expect(cleanerSteps([stale], [row("2026-09-06", noMerchant)], TODAY).inactive).toEqual([]);
		expect(cleanerSteps([stale], [row("2026-08-05", noMerchant)], TODAY).inactive).toEqual([]);
		expect(cleanerSteps([stale], [row("2026-07-05", noMerchant)], TODAY).inactive).toEqual(["s1"]);
		expect(cleanerSteps([stale], [row("2026-09-08", noMerchant)], TODAY).inactive).toEqual(["s1"]);
		expect(
			cleanerSteps(
				[stale],
				[row("2026-09-05", { ...noMerchant, amount: toMinorUnits(-2799) })],
				TODAY,
			).inactive,
		).toEqual(["s1"]);
	});

	it("never marks a suggestion inactive, and deletes one with no row in its window", () => {
		const old = { lastOccurrenceDate: "2026-06-05" };

		expect(cleanerSteps([series(old)], [], TODAY)).toEqual({ inactive: [], deleted: ["s1"] });
		expect(cleanerSteps([series(old)], [row("2026-07-06", noMerchant)], TODAY)).toEqual({
			inactive: [],
			deleted: [],
		});
	});

	it("leaves inactive and ended series alone", () => {
		const old = { lastOccurrenceDate: "2026-01-05" };

		expect(
			cleanerSteps(
				[series({ ...old, status: "inactive" }), series({ ...old, id: "s2", status: "ended" })],
				[],
				TODAY,
			),
		).toEqual({ inactive: [], deleted: [] });
	});
});
