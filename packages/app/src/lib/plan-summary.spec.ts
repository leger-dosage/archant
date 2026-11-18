import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { budgetDaysLeft, percentOf, topBudgetCategories } from "./plan-summary";

const line = (
	name: string,
	spent: number,
	budgetedSpending: number,
	parentId: string | null = null,
) => ({
	name,
	parentId,
	spent: toMinorUnits(spent),
	budgetedSpending: toMinorUnits(budgetedSpending),
});

describe("topBudgetCategories", () => {
	it("ranks parent categories by spending, then allocation, with no more than four", () => {
		const categories = [
			line("Unused", 0, 0),
			line("Second", 300, 500),
			line("First", 300, 800),
			line("Child", 500, 900, "parent"),
			line("Third", 200, 100),
			line("Fourth", 0, 1_000),
			line("Fifth", 0, 10),
		];

		expect(topBudgetCategories(categories).map(({ name }) => name)).toEqual([
			"First",
			"Second",
			"Third",
			"Fourth",
		]);
		expect(categories[0]?.name).toBe("Unused");
	});

	it("keeps categories with a net refund or an allocation but no spending", () => {
		expect(topBudgetCategories([line("Refund", -300, 0), line("Planned", 0, 500)])).toEqual([
			line("Planned", 0, 500),
			line("Refund", -300, 0),
		]);
	});
});

it("counts calendar days including today, and stops at zero after the period ends", () => {
	expect(budgetDaysLeft("2026-03-28", "2026-03-31")).toBe(4);
	expect(budgetDaysLeft("2026-03-31", "2026-03-31")).toBe(1);
	expect(budgetDaysLeft("2026-04-02", "2026-03-31")).toBe(0);
});

it("keeps the actual percentage over 100, and reports zero without a budget", () => {
	expect(percentOf(toMinorUnits(125), toMinorUnits(100))).toBe(125);
	expect(percentOf(toMinorUnits(125), toMinorUnits(0))).toBe(0);
});
