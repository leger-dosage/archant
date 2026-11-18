import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { addDays } from "./dates.ts";
import {
	backingShares,
	compareGoals,
	goalProgress,
	goalSeries,
	goalsSummary,
	monthsOfExpenses,
	goalHistoryStart,
} from "./goals.ts";

const fixed = (goalId: string, amount: number) => ({
	goalId,
	allocatedAmount: toMinorUnits(amount),
});
const whole = (goalId: string) => ({ goalId, allocatedAmount: null });
const shares = (balance: number, links: Parameters<typeof backingShares>[1]) =>
	Object.fromEntries(backingShares(toMinorUnits(balance), links));

describe("backingShares", () => {
	it("takes fixed amounts first and gives a whole-balance link the rest", () => {
		expect(shares(100_000, [fixed("A", 30_000), whole("B")])).toEqual({ A: 30_000, B: 70_000 });
	});

	it("scales fixed amounts above the balance down in proportion, leaving a whole link nothing", () => {
		expect(shares(50_000, [fixed("A", 30_000), fixed("B", 70_000), whole("C")])).toEqual({
			A: 15_000,
			B: 35_000,
			C: 0,
		});
	});

	it("floors each scaled share, so they never sum above the balance", () => {
		const result = shares(100, [fixed("A", 100), fixed("B", 100), fixed("C", 100)]);

		expect(result).toEqual({ A: 33, B: 33, C: 33 });
		expect(Object.values(result).reduce((sum, share) => sum + share, 0)).toBeLessThanOrEqual(100);
	});

	it("keeps fixed amounts that exactly fill the balance", () => {
		expect(shares(1000, [fixed("A", 400), fixed("B", 600), whole("C")])).toEqual({
			A: 400,
			B: 600,
			C: 0,
		});
	});

	it.each([
		["an overdrawn", -5000],
		["an empty", 0],
	])("backs nothing from %s balance", (_label, balance) => {
		expect(shares(balance, [fixed("A", 300), whole("B")])).toEqual({ A: 0, B: 0 });
	});

	it("gives a lone whole-balance link the whole balance", () => {
		expect(shares(123_456, [whole("A")])).toEqual({ A: 123_456 });
	});

	it("stays exact past what a float multiplies without loss", () => {
		const big = 9_000_000_000_000;

		expect(shares(big, [fixed("A", big), fixed("B", big)])).toEqual({
			A: big / 2,
			B: big / 2,
		});
	});
});

describe("goalHistoryStart", () => {
	it("goes back 90 days", () => {
		expect(goalHistoryStart("2026-09-21", "2020-01-01")).toBe("2026-06-23");
		expect(goalHistoryStart("2026-09-21", null)).toBe("2026-06-23");
	});

	it("starts at the opening date of an account opened since", () => {
		expect(goalHistoryStart("2026-09-21", "2026-08-01")).toBe("2026-08-01");
	});

	it("never starts after today, for an account opened at a future date", () => {
		expect(goalHistoryStart("2026-09-21", "2026-10-15")).toBe("2026-09-21");
	});
});

const progress = (overrides: Partial<Parameters<typeof goalProgress>[0]> = {}) =>
	goalProgress({
		kind: "one_off",
		target: toMinorUnits(100_000),
		saved: toMinorUnits(20_000),
		consumedAmount: toMinorUnits(0),
		targetDate: null,
		today: "2026-09-21",
		accounts: [],
		completed: false,
		...overrides,
	});

describe("goalProgress", () => {
	it("counts consumed money toward the target without increasing the remaining backing", () => {
		expect(
			progress({ consumedAmount: toMinorUnits(15_000), targetDate: "2026-10-21" }),
		).toMatchObject({
			saved: 20_000,
			consumedAmount: 15_000,
			progressAmount: 35_000,
			remaining: 65_000,
			percent: 35,
			monthlyNeeded: 65_000,
		});
	});

	it("has no monthly amount and no pace verdict without a date", () => {
		expect(progress()).toEqual({
			saved: 20_000,
			consumedAmount: 0,
			progressAmount: 20_000,
			remaining: 80_000,
			percent: 20,
			monthlyNeeded: null,
			pace: 0,
			status: "no_target_date",
		});
	});

	it("asks for all that remains once the date has passed", () => {
		expect(progress({ saved: toMinorUnits(60_000), targetDate: "2026-09-01" })).toMatchObject({
			remaining: 40_000,
			monthlyNeeded: 40_000,
			status: "behind",
		});
	});

	it("asks for all that remains on the day itself", () => {
		expect(progress({ targetDate: "2026-09-21" })).toMatchObject({ monthlyNeeded: 80_000 });
	});

	it("is reached, at 100 %, with nothing remaining, once saved meets the target", () => {
		expect(progress({ saved: toMinorUnits(120_000), targetDate: "2026-12-31" })).toMatchObject({
			remaining: 0,
			percent: 100,
			monthlyNeeded: 0,
			status: "reached",
		});
	});

	it("rounds the monthly amount up to the cent, over 30-day months counted in days", () => {
		// 80 000 × 30 / 100 days is 24 000; one cent over 7 days is 4.29 cents, so 5.
		expect(progress({ targetDate: "2026-12-30" })).toMatchObject({ monthlyNeeded: 24_000 });
		expect(progress({ saved: toMinorUnits(99_999), targetDate: "2026-09-28" })).toMatchObject({
			remaining: 1,
			monthlyNeeded: 5,
		});
	});

	it("floors the percentage and holds it at 99 until nothing remains", () => {
		expect(progress({ saved: toMinorUnits(33_399) }).percent).toBe(33);
		expect(progress({ saved: toMinorUnits(99_999) }).percent).toBe(99);
		expect(progress({ saved: toMinorUnits(0) }).percent).toBe(0);
	});

	it("is on track when the combined monthly pace covers the monthly amount", () => {
		const accounts = [
			{ change: toMinorUnits(90_000), months: 3 },
			{ change: toMinorUnits(120_000), months: 12 },
		] as const;

		expect(
			progress({ saved: toMinorUnits(60_000), targetDate: "2026-10-21", accounts }),
		).toMatchObject({ pace: 40_000, monthlyNeeded: 40_000, status: "on_track" });
		expect(
			progress({ saved: toMinorUnits(59_999), targetDate: "2026-10-21", accounts }),
		).toMatchObject({ monthlyNeeded: 40_001, status: "behind" });
	});

	it.each([
		[100, 33],
		[-100, -33],
		[102, 34],
	])("rounds %i over three months to %i", (change, pace) => {
		expect(progress({ accounts: [{ change: toMinorUnits(change), months: 3 }] }).pace).toBe(pace);
	});

	it("keeps pace unknown when any linked account is unmeasured", () => {
		const accounts = [{ change: toMinorUnits(90_000), months: 3 }, undefined] as const;

		expect(progress({ targetDate: "2026-10-21", accounts })).toMatchObject({
			pace: null,
			status: "pace_unknown",
		});
	});
});

describe("goalProgress of a completed goal", () => {
	it("is reached at 100 % on the amount frozen, even short of its target", () => {
		expect(
			progress({ saved: toMinorUnits(45_000), targetDate: "2027-01-01", completed: true }),
		).toMatchObject({ saved: 45_000, remaining: 55_000, percent: 100, status: "reached" });
	});

	it("reads an archived goal's frozen amount as any other saved amount", () => {
		expect(progress({ saved: toMinorUnits(45_000), targetDate: "2026-09-01" })).toMatchObject({
			saved: 45_000,
			percent: 45,
			status: "behind",
		});
	});
});

describe("goalProgress of a reserve", () => {
	it("is funded once its share covers its target, as Sure's maintained goal", () => {
		expect(
			progress({ kind: "maintained", saved: toMinorUnits(100_000), target: toMinorUnits(80_000) }),
		).toEqual({
			saved: 100_000,
			consumedAmount: 0,
			progressAmount: 100_000,
			remaining: 0,
			percent: 100,
			monthlyNeeded: null,
			pace: 0,
			status: "funded",
		});
	});

	it("is depleted below its target, and never asks for a monthly amount", () => {
		expect(
			progress({
				kind: "maintained",
				saved: toMinorUnits(30_000),
				target: toMinorUnits(80_000),
				targetDate: "2026-10-21",
			}),
		).toMatchObject({ remaining: 50_000, percent: 37, monthlyNeeded: null, status: "depleted" });
	});
});

describe("compareGoals", () => {
	it("sorts behind, on track, without a date, then reached, by French name within each", () => {
		const goals = (
			[
				["reached", "Voiture"],
				["no_target_date", "Réserve"],
				["on_track", "Vacances"],
				["behind", "Travaux"],
				["behind", "Été"],
				["behind", "anniversaire"],
			] as const
		).map(([status, name]) => ({ state: "active" as const, status, name }));

		expect(goals.toSorted(compareGoals).map((goal) => goal.name)).toEqual([
			"anniversaire",
			"Été",
			"Travaux",
			"Vacances",
			"Réserve",
			"Voiture",
		]);
	});

	it("sorts a depleted reserve with goals behind, a funded one with goals reached", () => {
		const goals = (
			[
				["funded", "Abri"],
				["reached", "Voiture"],
				["no_target_date", "Réserve"],
				["on_track", "Vacances"],
				["depleted", "Urgences"],
				["behind", "Travaux"],
			] as const
		).map(([status, name]) => ({ state: "active" as const, status, name }));

		expect(goals.toSorted(compareGoals).map((goal) => goal.name)).toEqual([
			"Travaux",
			"Urgences",
			"Vacances",
			"Réserve",
			"Abri",
			"Voiture",
		]);
	});

	it("puts paused, then completed, then archived goals after every active one, by name", () => {
		const goals = [
			{ state: "archived", status: "behind", name: "Ancien" },
			{ state: "completed", status: "reached", name: "Vélo" },
			{ state: "paused", status: "behind", name: "Travaux" },
			{ state: "paused", status: "on_track", name: "Piscine" },
			{ state: "active", status: "reached", name: "Voiture" },
			{ state: "completed", status: "reached", name: "Camping" },
		] as const;

		expect(goals.toSorted(compareGoals).map((goal) => goal.name)).toEqual([
			"Voiture",
			"Piscine",
			"Travaux",
			"Camping",
			"Vélo",
			"Ancien",
		]);
	});
});

describe("monthsOfExpenses", () => {
	it("multiplies the median monthly expenses by the months", () => {
		expect(monthsOfExpenses(6, toMinorUnits(200_000))).toBe(1_200_000);
	});

	it("accepts the largest safe product and refuses overflow", () => {
		expect(monthsOfExpenses(Number.MAX_SAFE_INTEGER, toMinorUnits(1))).toBe(
			Number.MAX_SAFE_INTEGER,
		);
		expect(monthsOfExpenses(Number.MAX_SAFE_INTEGER, toMinorUnits(2))).toBeNull();
	});

	it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("refuses %s months", (months) => {
		expect(monthsOfExpenses(months, toMinorUnits(2))).toBeNull();
	});

	it.each([
		["no median", null],
		["a median of zero", 0],
	])("has no target with %s", (_label, median) => {
		expect(monthsOfExpenses(6, median === null ? null : toMinorUnits(median))).toBeNull();
	});
});

/** One balance per day from `from`, as `balancesBetween` reads them. */
const daily = (from: string, amounts: readonly number[]) =>
	amounts.map((amount, index) => ({ date: addDays(from, index), balance: toMinorUnits(amount) }));

describe("goalSeries", () => {
	it("draws zero while the linked account has no starting balance", () => {
		expect(
			goalSeries({
				from: "2026-09-21",
				to: "2026-09-21",
				saved: toMinorUnits(0),
				accounts: [[]],
			}),
		).toEqual([{ date: "2026-09-21", saved: 0 }]);
	});

	it("scales the sum of balances, including one opened during the window", () => {
		const points = goalSeries({
			from: "2026-09-18",
			to: "2026-09-21",
			saved: toMinorUnits(210),
			accounts: [daily("2026-09-18", [100, 100, 200, 200]), daily("2026-09-20", [50, 80])],
		});

		expect(points.map((point) => point.saved)).toEqual([75, 75, 187, 210]);
	});

	it.each([
		{ saved: 500, balances: [100, 50], expected: [100, 50] },
		{ saved: 500, balances: [100, 0], expected: [0, 0] },
		{ saved: 500, balances: [100, -50], expected: [0, 0] },
	])(
		"caps the ratio and handles a non-positive current balance",
		({ saved, balances, expected }) => {
			const from = "2026-09-20";
			const points = goalSeries({
				from,
				to: "2026-09-21",
				saved: toMinorUnits(saved),
				accounts: [daily(from, balances)],
			});

			expect(points.map((point) => point.saved)).toEqual(expected);
		},
	);
});

const goal = (
	name: string,
	saved: number,
	target: number,
	overrides: Partial<Parameters<typeof goalsSummary>[0][number]> = {},
) => ({
	id: name,
	name,
	state: "active" as const,
	status: "on_track" as const,
	currency: "EUR",
	saved: toMinorUnits(saved),
	targetAmount: toMinorUnits(target),
	...overrides,
});

describe("goalsSummary", () => {
	it("keeps both goals when their combined target cannot be represented", () => {
		expect(
			goalsSummary([goal("Réserve", 0, Number.MAX_SAFE_INTEGER), goal("Vélo", 0, 1)], "EUR"),
		).toMatchObject({ count: 2, target: null });
	});

	it("sums the goals holding their money in the reporting currency, and names the others", () => {
		const summary = goalsSummary(
			[
				goal("Vacances", 20_000, 100_000, { status: "behind" }),
				goal("Vélo", 30_000, 50_000, { state: "paused", status: "behind" }),
				goal("Voyage", 10_000, 90_000, { currency: "USD", status: "behind" }),
				goal("Voiture", 80_000, 80_000, { state: "completed", status: "reached" }),
				goal("Ancien", 5_000, 10_000, { state: "archived" }),
			],
			"EUR",
		);

		expect(summary).toEqual({
			currency: "EUR",
			count: 3,
			saved: 50_000,
			target: 150_000,
			// A paused goal is never behind, as Sure's `behind_pace?`.
			behind: 2,
			paceUnknown: 0,
			leftOut: [{ id: "Voyage", name: "Voyage" }],
			goals: [expect.objectContaining({ name: "Vacances" }), expect.anything(), expect.anything()],
		});
		expect(summary.goals.map((item) => item.name)).toEqual(["Vacances", "Vélo", "Voyage"]);
	});

	it("counts a reserve in what is saved and aimed for, never as behind", () => {
		expect(
			goalsSummary(
				[
					goal("Urgences", 30_000, 80_000, { status: "depleted" }),
					goal("Abri", 100_000, 80_000, { status: "funded" }),
				],
				"EUR",
			),
		).toMatchObject({ count: 2, saved: 130_000, target: 160_000, behind: 0 });
	});

	it("lists the first five, and nothing without a goal holding its money", () => {
		const many = ["A", "B", "C", "D", "E", "F"].map((name) => goal(name, 0, 100));

		expect(goalsSummary(many, "EUR").goals.map((item) => item.name)).toEqual([
			"A",
			"B",
			"C",
			"D",
			"E",
		]);
		expect(goalsSummary([goal("Fini", 100, 100, { state: "completed" })], "EUR")).toMatchObject({
			count: 0,
			saved: 0,
			target: 0,
			behind: 0,
			leftOut: [],
			goals: [],
		});
	});
});
