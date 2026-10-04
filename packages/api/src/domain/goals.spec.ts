import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { backingShares, compareGoals, goalProgress, paceStart } from "./goals.ts";

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

describe("paceStart", () => {
	it("goes back 90 days", () => {
		expect(paceStart("2026-09-21", "2020-01-01")).toBe("2026-06-23");
		expect(paceStart("2026-09-21", null)).toBe("2026-06-23");
	});

	it("starts at the opening date of an account opened since", () => {
		expect(paceStart("2026-09-21", "2026-08-01")).toBe("2026-08-01");
	});

	it("never starts after today, for an account opened at a future date", () => {
		expect(paceStart("2026-09-21", "2026-10-15")).toBe("2026-09-21");
	});
});

const progress = (overrides: Partial<Parameters<typeof goalProgress>[0]> = {}) =>
	goalProgress({
		target: toMinorUnits(100_000),
		saved: toMinorUnits(20_000),
		targetDate: null,
		today: "2026-09-21",
		accounts: [],
		...overrides,
	});

describe("goalProgress", () => {
	it("has no monthly amount and no pace verdict without a date", () => {
		expect(progress()).toEqual({
			saved: 20_000,
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

	it("is on track when the 90-day pace covers the monthly amount", () => {
		// Two accounts gained 900 and 300: 1 200 over three months is 400 a month.
		const accounts = [
			{ now: toMinorUnits(150_000), before: toMinorUnits(60_000) },
			{ now: toMinorUnits(40_000), before: toMinorUnits(10_000) },
		];

		expect(
			progress({ saved: toMinorUnits(60_000), targetDate: "2026-10-21", accounts }),
		).toMatchObject({ pace: 40_000, monthlyNeeded: 40_000, status: "on_track" });
		expect(
			progress({ saved: toMinorUnits(59_999), targetDate: "2026-10-21", accounts }),
		).toMatchObject({ monthlyNeeded: 40_001, status: "behind" });
	});

	it("floors a falling pace toward the lower cent", () => {
		const accounts = [{ now: toMinorUnits(0), before: toMinorUnits(100) }];

		expect(progress({ accounts }).pace).toBe(-34);
		expect(progress({ accounts: [{ now: toMinorUnits(100), before: toMinorUnits(0) }] }).pace).toBe(
			33,
		);
		expect(progress({ accounts: [{ now: toMinorUnits(0), before: toMinorUnits(99) }] }).pace).toBe(
			-33,
		);
	});
});

describe("compareGoals", () => {
	it("sorts behind, on track, without a date, then reached, by French name within each", () => {
		const goals = [
			{ status: "reached", name: "Voiture" },
			{ status: "no_target_date", name: "Réserve" },
			{ status: "on_track", name: "Vacances" },
			{ status: "behind", name: "Travaux" },
			{ status: "behind", name: "Été" },
			{ status: "behind", name: "anniversaire" },
		] as const;

		expect(goals.toSorted(compareGoals).map((goal) => goal.name)).toEqual([
			"anniversaire",
			"Été",
			"Travaux",
			"Vacances",
			"Réserve",
			"Voiture",
		]);
	});
});
