import { describe, expect, it } from "vitest";

import { budgetBounds, budgetMonthOf, budgetPeriod, isBudgetMonth, neighbours } from "./months.ts";

describe("budget periods", () => {
	it("round-trips the slug from the start and end, including the 28th across February", () => {
		expect(budgetMonthOf("2027-02-03", 25)).toBe("2027-01");
		expect(budgetMonthOf("2027-02-25", 25)).toBe("2027-02");
		expect(budgetMonthOf("2027-02-26", 25)).toBe("2027-02");
		const dates = budgetPeriod("2028-02", 28);
		expect(dates).toEqual({ startDate: "2028-02-28", endDate: "2028-03-27" });
		expect(budgetMonthOf(dates.startDate, 28)).toBe("2028-02");
		expect(budgetMonthOf(dates.endDate, 28)).toBe("2028-02");
	});
});

describe("budgetBounds", () => {
	it("runs from two years back to two years ahead of the current month", () => {
		expect(budgetBounds("2026-10", "2026-03-14", 1)).toEqual({ from: "2024-10", to: "2028-10" });
	});

	it("reaches back to the oldest entry's month, as Sure's budget_date_valid?", () => {
		expect(budgetBounds("2026-10", "2019-02-28", 1)).toEqual({ from: "2019-02", to: "2028-10" });
	});

	it("starts two years back when nothing is recorded yet", () => {
		expect(budgetBounds("2026-01", null, 1)).toEqual({ from: "2024-01", to: "2028-01" });
	});
});

describe("isBudgetMonth", () => {
	const bounds = { from: "2024-10", to: "2028-10" };

	it("accepts both bounds and every month between", () => {
		expect(isBudgetMonth("2024-10", bounds)).toBe(true);
		expect(isBudgetMonth("2026-10", bounds)).toBe(true);
		expect(isBudgetMonth("2028-10", bounds)).toBe(true);
	});

	it("refuses a month before the first or after the last", () => {
		expect(isBudgetMonth("2024-09", bounds)).toBe(false);
		expect(isBudgetMonth("2028-11", bounds)).toBe(false);
	});
});

describe("neighbours", () => {
	const bounds = { from: "2024-10", to: "2028-10" };

	it("names the month before and after, across a year", () => {
		expect(neighbours("2026-01", bounds)).toEqual({
			previousMonth: "2025-12",
			nextMonth: "2026-02",
		});
	});

	it("has no neighbour past a bound", () => {
		expect(neighbours("2024-10", bounds)).toEqual({ previousMonth: null, nextMonth: "2024-11" });
		expect(neighbours("2028-10", bounds)).toEqual({ previousMonth: "2028-09", nextMonth: null });
	});
});
