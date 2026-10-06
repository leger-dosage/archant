import type { MatchContext, MatchEntry, MatchOccurrence, MatchSeries } from "./matcher.ts";
import type { RecurrenceRule } from "./schedule.ts";

import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { entryWindow, explain, matchPayments, rejectionKey, windowOf } from "./matcher.ts";
import { monthlyOn } from "./schedule.ts";

const MORTGAGE_AMOUNT = -57_129;

function series(overrides: Partial<MatchSeries> = {}): MatchSeries {
	const rules: RecurrenceRule[] = overrides.schedule?.rules.slice() ?? [monthlyOn(5)];

	return {
		id: "s1",
		accountId: "a1",
		currency: "EUR",
		amount: toMinorUnits(MORTGAGE_AMOUNT),
		merchantId: null,
		labelKey: "prlv credit immo",
		name: null,
		nameAliases: [],
		learnedTolerance: null,
		billType: "installment",
		...overrides,
		schedule: overrides.schedule ?? {
			rules,
			anchorDate: "2026-10-05",
			endAfterCount: null,
			expectedDayOfMonth: 5,
		},
	};
}

const occurrence = (
	id: string,
	dueOn: string,
	overrides: Partial<MatchOccurrence> = {},
): MatchOccurrence => ({
	id,
	seriesId: "s1",
	dueOn,
	snoozedUntil: null,
	expectedAmount: null,
	...overrides,
});

const entry = (
	id: string,
	date: string,
	amount: number,
	overrides: Partial<MatchEntry> = {},
): MatchEntry => ({
	id,
	accountId: "a1",
	currency: "EUR",
	date,
	amount: toMinorUnits(amount),
	merchantId: null,
	label: "PRLV CREDIT IMMO",
	pending: false,
	excluded: false,
	splitParent: false,
	transfer: null,
	...overrides,
});

const context = (today: string, overrides: Partial<MatchContext> = {}): MatchContext => ({
	today,
	rejected: new Set(),
	confirmedEntryIds: new Set(),
	...overrides,
});

const byId = (...all: MatchSeries[]) => new Map(all.map((one) => [one.id, one]));

const live = { backfill: false };
const backfill = { backfill: true };

/** The signals of one payment of `paid` on `date` against an occurrence expecting `expected`. */
const signalsOf = (expected: number, paid: number, date: string, today: string) =>
	matchPayments(
		byId(series()),
		[occurrence("o1", "2026-08-05", { expectedAmount: toMinorUnits(expected) })],
		[entry("e1", date, -paid)],
		context(today),
		live,
	)[0]?.signals;

/** A pending payment of the mortgage a day late. */
const pendingRun = (options: { backfill: boolean }) =>
	matchPayments(
		byId(series()),
		[occurrence("o1", "2026-08-05")],
		[entry("e1", "2026-08-06", MORTGAGE_AMOUNT, { pending: true })],
		context("2026-08-06"),
		options,
	);

describe("matchPayments", () => {
	it("suggests the mortgage paid 571,36 € five days late, at 0.8165 without a merchant", () => {
		const decisions = matchPayments(
			byId(series()),
			[occurrence("o1", "2026-08-05")],
			[entry("e1", "2026-08-10", -57_136)],
			context("2026-08-10"),
			live,
		);

		expect(decisions).toEqual([
			{
				occurrenceId: "o1",
				entryId: "e1",
				state: "suggested",
				score: 8165,
				signals: { name: 3500, amount: 2498, date: 1167, account: 1000 },
			},
		]);
	});

	it("confirms the same payment at 0.8665 when the series has a merchant", () => {
		const decisions = matchPayments(
			byId(series({ merchantId: "m1", labelKey: null })),
			[occurrence("o1", "2026-08-05")],
			[entry("e1", "2026-08-10", -57_136, { merchantId: "m1", label: "anything" })],
			context("2026-08-10"),
			live,
		);

		expect(decisions).toMatchObject([
			{ state: "confirmed", score: 8665, signals: { merchant: 4000 } },
		]);
	});

	it("scores 0.8881 once the occurrence is overdue and its window runs to today", () => {
		const decisions = matchPayments(
			byId(series()),
			[occurrence("o1", "2026-08-05")],
			[entry("e1", "2026-08-10", -57_136)],
			context("2026-10-06"),
			backfill,
		);

		expect(decisions).toMatchObject([{ state: "confirmed", score: 8881 }]);
	});

	it("scores the exact amount on the due date 0.95, and reads a name or an alias", () => {
		const named = series({
			labelKey: "other",
			name: "Prêt immobilier",
			nameAliases: ["ÉCHÉANCE PRÊT"],
		});

		expect(
			matchPayments(
				byId(named),
				[occurrence("o1", "2026-08-05"), occurrence("o2", "2026-09-05")],
				[
					entry("e1", "2026-08-05", MORTGAGE_AMOUNT, { label: "pret  IMMOBILIER" }),
					entry("e2", "2026-09-05", MORTGAGE_AMOUNT, { label: "Echeance pret" }),
				],
				context("2026-09-05"),
				live,
			),
		).toMatchObject([
			{ occurrenceId: "o1", entryId: "e1", state: "confirmed", score: 9500 },
			{ occurrenceId: "o2", entryId: "e2", state: "confirmed", score: 9500 },
		]);
	});

	it("reads an occurrence's frozen amount before the series'", () => {
		expect(
			matchPayments(
				byId(series()),
				[occurrence("o1", "2026-08-05", { expectedAmount: toMinorUnits(60_000) })],
				[entry("e1", "2026-08-05", -60_000)],
				context("2026-08-05"),
				live,
			),
		).toMatchObject([{ score: 9500 }]);
	});

	it("leaves out a payment of another currency, account, sign, merchant or name", () => {
		const merchant = series({ id: "s2", merchantId: "m1", labelKey: null });
		const decisions = matchPayments(
			byId(series(), merchant),
			[occurrence("o1", "2026-08-05"), occurrence("o2", "2026-08-05", { seriesId: "s2" })],
			[
				entry("e1", "2026-08-05", MORTGAGE_AMOUNT, { currency: "USD" }),
				entry("e2", "2026-08-05", MORTGAGE_AMOUNT, { accountId: "a2" }),
				entry("e3", "2026-08-05", -MORTGAGE_AMOUNT),
				entry("e4", "2026-08-05", MORTGAGE_AMOUNT, { label: "PRLV AUTRE" }),
				entry("e5", "2026-08-05", MORTGAGE_AMOUNT, { merchantId: "m2", label: "PRLV AUTRE" }),
			],
			context("2026-08-05"),
			live,
		);

		expect(decisions).toEqual([]);
	});

	it("leaves out an excluded row, a split parent and a transfer side, but keeps a loan payment's outflow", () => {
		const decisions = matchPayments(
			byId(series()),
			[
				occurrence("o1", "2026-08-05"),
				occurrence("o2", "2026-09-05"),
				occurrence("o3", "2026-10-05"),
				occurrence("o4", "2026-11-05"),
			],
			[
				entry("e1", "2026-08-05", MORTGAGE_AMOUNT, { excluded: true }),
				entry("e2", "2026-09-05", MORTGAGE_AMOUNT, { splitParent: true }),
				entry("e3", "2026-10-05", MORTGAGE_AMOUNT, { transfer: { kind: "internal_move" } }),
				entry("e4", "2026-11-05", MORTGAGE_AMOUNT, { transfer: { kind: "loan_payment" } }),
			],
			context("2026-11-05"),
			live,
		);

		expect(decisions).toMatchObject([{ occurrenceId: "o4", entryId: "e4" }]);
	});

	it("never suggests a rejected pair again, nor a transaction already confirmed", () => {
		const decisions = matchPayments(
			byId(series()),
			[occurrence("o1", "2026-08-05"), occurrence("o2", "2026-09-05")],
			[entry("e1", "2026-08-10", -57_136), entry("e2", "2026-09-05", MORTGAGE_AMOUNT)],
			context("2026-09-05", {
				rejected: new Set([rejectionKey("s1", "e1")]),
				confirmedEntryIds: new Set(["e2"]),
			}),
			live,
		);

		expect(decisions).toEqual([]);
	});

	it("drops an amount outside 7.5 %, and widens the band to the learned tolerance, never past 25 %", () => {
		const occurrences = [occurrence("o1", "2026-08-05", { expectedAmount: toMinorUnits(10_000) })];
		const run = (amount: number, learnedTolerance: number | null) =>
			matchPayments(
				byId(series({ learnedTolerance })),
				occurrences,
				[entry("e1", "2026-08-05", -amount)],
				context("2026-08-05"),
				live,
			);

		// At the band's edge the amount scores 1500.
		expect(run(10_750, null)).toMatchObject([{ score: 8000, signals: { amount: 1500 } }]);
		expect(run(10_751, null)).toEqual([]);
		expect(run(10_800, 80)).toMatchObject([{ signals: { amount: 1500 } }]);
		expect(run(12_500, 400)).toMatchObject([{ signals: { amount: 1500 } }]);
		expect(run(12_600, 400)).toEqual([]);
	});

	it("matches nothing against an occurrence that expects nothing", () => {
		expect(
			matchPayments(
				byId(series()),
				[occurrence("o1", "2026-08-05", { expectedAmount: toMinorUnits(0) })],
				[entry("e1", "2026-08-05", -1)],
				context("2026-08-05"),
				live,
			),
		).toEqual([]);
	});

	it("rounds each signal half up, as Sure's `round(4)`", () => {
		// 2500 − 1000 × 0,01 / 3,00 = 2496.67; 2000 − 1500 × 1 / 9 = 1833.33.
		expect(signalsOf(4000, 4001, "2026-08-06", "2026-08-06")).toEqual({
			name: 3500,
			amount: 2497,
			date: 1833,
			account: 1000,
		});
		// 2500 − 1000 × 0,03 / 0,096 = 2187.5; overdue, 2000 − 1500 × 2 / 16 = 1812.5.
		expect(signalsOf(128, 131, "2026-08-07", "2026-08-19")).toEqual({
			name: 3500,
			amount: 2188,
			date: 1813,
			account: 1000,
		});
	});

	it("keeps within one series only the occurrence nearest the payment, the first on a tie", () => {
		// Weekly, so the overdue windows of two weeks overlap on one payment.
		const weekly = series({
			schedule: {
				rules: [{ frequency: "weekly", interval: 1, weekday: 1 }],
				anchorDate: "2026-08-03",
				endAfterCount: null,
				expectedDayOfMonth: 3,
			},
		});
		const decisions = matchPayments(
			byId(weekly),
			[occurrence("o1", "2026-08-03"), occurrence("o2", "2026-08-10")],
			[entry("e1", "2026-08-11", MORTGAGE_AMOUNT)],
			context("2026-08-20"),
			live,
		);

		expect(decisions).toMatchObject([{ occurrenceId: "o2", entryId: "e1", state: "confirmed" }]);

		// A snoozed occurrence shares the other's effective date: the first listed wins.
		const tie = matchPayments(
			byId(weekly),
			[
				occurrence("o2", "2026-08-10"),
				occurrence("o1", "2026-08-03", { snoozedUntil: "2026-08-10" }),
			],
			[entry("e1", "2026-08-10", MORTGAGE_AMOUNT)],
			context("2026-08-10"),
			live,
		);

		expect(tie).toMatchObject([{ occurrenceId: "o2", state: "confirmed" }]);
	});

	it("only suggests a payment two series score within 0.15 of each other", () => {
		const other = series({ id: "s2", labelKey: "prlv credit immo", amount: toMinorUnits(-60_000) });
		const decisions = matchPayments(
			byId(series(), other),
			[occurrence("o1", "2026-08-05"), occurrence("o2", "2026-08-07", { seriesId: "s2" })],
			[entry("e1", "2026-08-05", MORTGAGE_AMOUNT)],
			context("2026-08-05"),
			live,
		);

		expect(decisions).toMatchObject([{ occurrenceId: "o1", state: "suggested", score: 9500 }]);
	});

	it("confirms a payment 0.15 ahead of the other series' score", () => {
		const other = series({ id: "s2", amount: toMinorUnits(-61_000) });
		const decisions = matchPayments(
			byId(series(), other),
			[occurrence("o1", "2026-08-05"), occurrence("o2", "2026-08-07", { seriesId: "s2" })],
			[entry("e1", "2026-08-05", MORTGAGE_AMOUNT)],
			context("2026-08-05"),
			live,
		);

		// The other series scores 3500 + 1654 + 1667 + 1000 = 7821, 0.1679 behind.
		expect(decisions).toMatchObject([{ occurrenceId: "o1", state: "confirmed" }]);
	});

	it("takes each transaction and each occurrence once, the highest score first", () => {
		const decisions = matchPayments(
			byId(series()),
			[occurrence("o1", "2026-08-05")],
			[entry("e1", "2026-08-07", MORTGAGE_AMOUNT), entry("e2", "2026-08-05", MORTGAGE_AMOUNT)],
			context("2026-08-07"),
			live,
		);

		expect(decisions).toMatchObject([{ occurrenceId: "o1", entryId: "e2", score: 9500 }]);
	});

	it("breaks a tie by occurrence then entry id", () => {
		const other = series({ id: "s2", labelKey: "prlv credit immo" });
		const decisions = matchPayments(
			byId(other, series()),
			[occurrence("o2", "2026-08-05", { seriesId: "s2" }), occurrence("o1", "2026-08-05")],
			[entry("e2", "2026-08-05", MORTGAGE_AMOUNT), entry("e1", "2026-08-05", MORTGAGE_AMOUNT)],
			context("2026-08-05"),
			live,
		);

		// Four candidates at 9500, each ambiguous: suggested, o1 with e1 then o2 with e2.
		expect(decisions).toMatchObject([
			{ occurrenceId: "o1", entryId: "e1", state: "suggested" },
			{ occurrenceId: "o2", entryId: "e2", state: "suggested" },
		]);
	});

	it("only suggests a pending payment, which a backfill leaves alone", () => {
		expect(pendingRun(live)).toMatchObject([{ state: "suggested", score: 9333 }]);
		expect(pendingRun(backfill)).toEqual([]);
	});

	it("never suggests an income, but confirms one from 0.85", () => {
		const salary = series({
			amount: toMinorUnits(250_000),
			labelKey: "salaire",
			billType: "income",
		});
		const run = (amount: number) =>
			matchPayments(
				byId(salary),
				[occurrence("o1", "2026-08-05")],
				[entry("e1", "2026-08-12", amount, { label: "SALAIRE" })],
				context("2026-08-12"),
				live,
			);

		// 3500 + 1500 + 833 + 1000: 0.6833.
		expect(run(268_750)).toEqual([]);
		// 3500 + 3000 + 833 + 1000: 0.8333.
		expect(run(250_000)).toEqual([]);

		expect(
			matchPayments(
				byId(salary),
				[occurrence("o1", "2026-08-05")],
				[entry("e1", "2026-08-05", 250_000, { label: "SALAIRE" })],
				context("2026-08-05"),
				live,
			),
		).toMatchObject([{ state: "confirmed", score: 9500 }]);
	});

	it("suggests a payment at the band's edge 7 days late, at 0.6833", () => {
		const decisions = matchPayments(
			byId(series()),
			[occurrence("o1", "2026-08-05", { expectedAmount: toMinorUnits(10_000) })],
			[entry("e1", "2026-08-12", -10_750)],
			context("2026-08-12"),
			live,
		);

		expect(decisions).toMatchObject([{ state: "suggested", score: 6833 }]);
	});

	it("leaves out a payment before or after the window of an occurrence not yet overdue", () => {
		const outsideWindow = matchPayments(
			byId(series()),
			[occurrence("o1", "2026-08-05")],
			[entry("e1", "2026-08-13", MORTGAGE_AMOUNT), entry("e2", "2026-08-02", MORTGAGE_AMOUNT)],
			context("2026-08-08"),
			live,
		);

		expect(outsideWindow).toEqual([]);
	});
});

describe("windowOf", () => {
	const monthly = series();

	it("opens 2 days before the due date and closes 7 after", () => {
		expect(windowOf(monthly, occurrence("o1", "2026-08-05"), "2026-08-01")).toEqual({
			start: "2026-08-03",
			end: "2026-08-12",
		});
	});

	it("starts from a snooze, and stays open to today once overdue", () => {
		expect(
			windowOf(
				monthly,
				occurrence("o1", "2026-08-05", { snoozedUntil: "2026-08-20" }),
				"2026-08-21",
			),
		).toEqual({ start: "2026-08-18", end: "2026-08-27" });
		// Due 5 August: overdue from the 9th.
		expect(windowOf(monthly, occurrence("o1", "2026-08-05"), "2026-08-08")).toEqual({
			start: "2026-08-03",
			end: "2026-08-12",
		});
		expect(windowOf(monthly, occurrence("o1", "2026-08-05"), "2026-10-06")).toEqual({
			start: "2026-08-03",
			end: "2026-10-06",
		});
	});

	it("caps each side under half a weekly bill's cycle", () => {
		const weekly = series({
			schedule: {
				rules: [{ frequency: "weekly", interval: 1, weekday: 3 }],
				anchorDate: "2026-08-05",
				endAfterCount: null,
				expectedDayOfMonth: 5,
			},
		});

		// A cycle of 7 days: 3 a side at most, so 2 before and 3 after, never 7.
		expect(windowOf(weekly, occurrence("o1", "2026-08-05"), "2026-08-01")).toEqual({
			start: "2026-08-03",
			end: "2026-08-08",
		});
	});

	it("keeps one day a side for a cadence of a day or two", () => {
		const twiceAWeek = series({
			schedule: {
				rules: [
					{ frequency: "weekly", interval: 1, weekday: 1 },
					{ frequency: "weekly", interval: 1, weekday: 2 },
					{ frequency: "weekly", interval: 1, weekday: 3 },
					{ frequency: "weekly", interval: 1, weekday: 4 },
				],
				anchorDate: "2026-08-03",
				endAfterCount: null,
				expectedDayOfMonth: 3,
			},
		});

		expect(windowOf(twiceAWeek, occurrence("o1", "2026-08-05"), "2026-08-01")).toEqual({
			start: "2026-08-04",
			end: "2026-08-06",
		});
	});
});

describe("entryWindow", () => {
	const all = byId(series());

	it("spans every window, up to today for a live run and past it for a backfill", () => {
		const occurrences = [occurrence("o1", "2026-08-05"), occurrence("o2", "2026-07-05")];

		expect(entryWindow(all, occurrences, "2026-08-06", false)).toEqual({
			start: "2026-07-03",
			end: "2026-08-06",
		});
		expect(entryWindow(all, occurrences, "2026-08-06", true)).toEqual({
			start: "2026-07-03",
			end: "2026-08-12",
		});
		expect(entryWindow(all, [occurrence("o1", "2026-08-05")], "2026-09-01", false)).toEqual({
			start: "2026-08-03",
			end: "2026-09-01",
		});
	});

	it("is null without an open occurrence", () => {
		expect(entryWindow(all, [], "2026-08-06", false)).toBeNull();
	});
});

describe("explain", () => {
	it("scores a payment as a run does", () => {
		expect(
			explain(
				series(),
				occurrence("o1", "2026-08-05"),
				entry("e1", "2026-08-10", -57_136),
				"2026-08-10",
			),
		).toEqual({ score: 8165, signals: { name: 3500, amount: 2498, date: 1167, account: 1000 } });
	});

	it("is null for a payment of another series, outside the window or outside the band", () => {
		const due = occurrence("o1", "2026-08-05");

		expect(
			explain(
				series(),
				due,
				entry("e1", "2026-08-05", MORTGAGE_AMOUNT, { label: "x" }),
				"2026-08-05",
			),
		).toBeNull();
		expect(
			explain(series(), due, entry("e1", "2026-08-20", MORTGAGE_AMOUNT), "2026-08-05"),
		).toBeNull();
		expect(explain(series(), due, entry("e1", "2026-08-05", -90_000), "2026-08-05")).toBeNull();
	});
});
