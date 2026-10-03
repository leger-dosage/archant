import type { CashFlowLine, MonthBreakdown } from "../cash-flow.ts";

import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { actualsOf, medianOf, spendingSegments, suggestions } from "./actuals.ts";

const line = (categoryId: string | null, amount: number): CashFlowLine => ({
	categoryId,
	name: categoryId,
	color: categoryId === null ? null : "#e99537",
	icon: categoryId === null ? null : "tag",
	amount: toMinorUnits(amount),
	share: null,
});

const breakdown = (expense: CashFlowLine[], income: CashFlowLine[] = []) => ({
	income: toMinorUnits(income.reduce((sum, item) => sum + item.amount, 0)),
	lines: { income, expense },
});

describe("actualsOf", () => {
	it("adds what each expense category spent and the uncategorised outflow", () => {
		const month = breakdown([line("courses", -12_000), line(null, -3_000), line("loyer", -80_000)]);

		expect(actualsOf(month).spending).toBe(95_000);
	});

	it("lets a refund lower its category, and a category refunded beyond spend nothing", () => {
		// `clothes` nets +30,00: refunded more than it spent this month.
		const month = breakdown([line("courses", -4_000), line("clothes", 3_000)]);

		expect(actualsOf(month).spending).toBe(4_000);
	});

	it("takes the income side's total, never below zero", () => {
		expect(actualsOf(breakdown([], [line("salaire", 250_000), line(null, 1_000)])).income).toBe(
			251_000,
		);
		// An income category that only paid money back nets negative.
		expect(actualsOf(breakdown([], [line("salaire", -5_000)])).income).toBe(0);
	});

	it("counts nothing in a month without a line", () => {
		expect(actualsOf(breakdown([]))).toEqual({ spending: 0, income: 0 });
	});
});

describe("spendingSegments", () => {
	it("keeps the lines that spent, largest first, as positive amounts", () => {
		const segments = spendingSegments([
			line("courses", -4_000),
			line("clothes", 3_000),
			line(null, -9_000),
			line("loyer", -80_000),
		]);

		expect(segments.map((segment) => [segment.categoryId, segment.spent])).toEqual([
			["loyer", 80_000],
			[null, 9_000],
			["courses", 4_000],
		]);
		expect(segments[0]).toEqual({
			categoryId: "loyer",
			name: "loyer",
			color: "#e99537",
			icon: "tag",
			spent: 80_000,
		});
	});

	it("keeps the order it was given between lines of the same size", () => {
		const segments = spendingSegments([line("b", -1_000), line("a", -1_000)]);

		expect(segments.map((segment) => segment.categoryId)).toEqual(["b", "a"]);
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

const month = (
	value: string,
	expense: CashFlowLine[],
	income: CashFlowLine[] = [],
): MonthBreakdown => ({ month: value, ...breakdown(expense, income) });

describe("suggestions", () => {
	it("takes the median of the earlier months that spent, as Sure's estimated spending", () => {
		const history = [
			month("2026-04", [line("courses", -10_000)]),
			month("2026-05", [line("courses", -30_000)]),
			month("2026-06", [line("courses", -20_000)]),
			month("2026-07", [line("courses", -40_000)]),
		];

		expect(suggestions(history, "2026-08", "2026-10").spending).toBe(25_000);
	});

	it("counts only the months before both the shown month and the current one", () => {
		const history = [
			month("2026-07", [line("courses", -10_000)]),
			month("2026-08", [line("courses", -50_000)]),
			month("2026-09", [line("courses", -90_000)]),
			// The current, partial month: never counted.
			month("2026-10", [line("courses", -1_000)]),
		];

		expect(suggestions(history, "2026-09", "2026-10").spending).toBe(30_000);
		expect(suggestions(history, "2027-03", "2026-10").spending).toBe(50_000);
	});

	it("enters a month in a side's median only when it has a line on that side", () => {
		const history = [
			month("2026-06", [line("courses", -10_000)]),
			month("2026-07", [], [line("salaire", 200_000)]),
			month("2026-08", [line("courses", -30_000)], [line("salaire", 300_000)]),
			// A refund alone still has a line: a month that spent nothing.
			month("2026-09", [line("clothes", 3_000)]),
		];

		expect(suggestions(history, "2026-10", "2026-10")).toEqual({
			spending: 10_000,
			income: 250_000,
		});
	});

	it("suggests nothing without an earlier month", () => {
		expect(suggestions([], "2026-10", "2026-10")).toEqual({ spending: null, income: null });
		expect(
			suggestions([month("2026-10", [line("courses", -1_000)])], "2026-10", "2026-10"),
		).toEqual({ spending: null, income: null });
	});
});
