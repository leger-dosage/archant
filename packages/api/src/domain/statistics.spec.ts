import type { MonthlyCashFlowRow } from "./statistics.ts";

import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { averageOf, categoryStats, familyStats, medianOf } from "./statistics.ts";

const row = (month: string, categoryId: string | null, amount: number): MonthlyCashFlowRow => ({
	month,
	categoryId,
	amount: toMinorUnits(amount),
});

describe("familyStats", () => {
	it("takes each side over the months holding a line of it, gaps left out", () => {
		const stats = familyStats([
			row("2026-01", "courses", -10_000),
			row("2026-02", "salaire", 200_000),
			row("2026-03", "courses", -30_000),
		]);

		expect(stats).toEqual({
			income: { median: 200_000, average: 200_000 },
			expense: { median: 20_000, average: 20_000 },
		});
	});

	it("keeps a refund month on both sides rather than at zero", () => {
		const stats = familyStats([
			row("2026-04", "courses", -10_000),
			row("2026-04", "courses", 10_000),
		]);

		expect(stats).toEqual({
			income: { median: 10_000, average: 10_000 },
			expense: { median: 10_000, average: 10_000 },
		});
	});

	it("sums a month's categories on one side before taking the median", () => {
		const stats = familyStats([
			row("2026-01", "courses", -10_000),
			row("2026-01", "loyer", -50_000),
			row("2026-02", "courses", -20_000),
			row("2026-03", null, -1),
		]);

		// Months 60 000, 20 000 and 1: the median is the middle one, the mean rounds.
		expect(stats.expense).toEqual({ median: 20_000, average: 26_667 });
	});

	it("counts the current and future months it is given", () => {
		const stats = familyStats([
			row("2026-10", "courses", -10_000),
			row("2026-11", "courses", -30_000),
		]);

		expect(stats.expense.median).toBe(20_000);
	});

	it("has nothing to say of a side without a month", () => {
		expect(familyStats([])).toEqual({
			income: { median: null, average: null },
			expense: { median: null, average: null },
		});
	});
});

describe("categoryStats", () => {
	it("reads a parent's own rows alone, never its children's", () => {
		// `parent` is `child`'s parent; the statistics never read the tree.
		const stats = categoryStats([
			row("2026-05", "parent", -1_000),
			row("2026-05", "child", -5_000),
		]);

		expect(stats.get("parent")?.expense.median).toBe(1_000);
		expect(stats.get("child")?.expense.median).toBe(5_000);
	});

	it("keys uncategorised rows by null, and has no key for a category without a row", () => {
		const stats = categoryStats([row("2026-05", null, -2_000), row("2026-06", null, 500)]);

		expect(stats.get(null)).toEqual({
			income: { median: 500, average: 500 },
			expense: { median: 2_000, average: 2_000 },
		});
		expect(stats.has("courses")).toBe(false);
	});
});

describe("averageOf", () => {
	it("rounds to the minor unit, and has nothing to say of nothing", () => {
		expect(averageOf([toMinorUnits(1), toMinorUnits(2)])).toBe(2);
		expect(averageOf([])).toBeNull();
	});
});

describe("medianOf", () => {
	it("takes the middle value of an odd count", () => {
		expect(medianOf([300, 100, 200].map(toMinorUnits))).toBe(200);
	});

	it("averages the two middle values of an even count", () => {
		expect(medianOf([100, 300, 200, 400].map(toMinorUnits))).toBe(250);
	});

	it("rounds an average that falls between two minor units", () => {
		expect(medianOf([100, 101].map(toMinorUnits))).toBe(101);
		expect(medianOf([100, 103].map(toMinorUnits))).toBe(102);
	});

	it("has no median without a value", () => {
		expect(medianOf([])).toBeNull();
	});
});
