import type { CashFlowCategory, CashFlowRow, CashFlowTransaction } from "./cash-flow.ts";

import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { cashFlowBreakdown, countsInCashFlow, direction } from "./cash-flow.ts";

const tx = (
	amount: number,
	transfer: CashFlowTransaction["transfer"] = null,
): CashFlowTransaction => ({ amount: toMinorUnits(amount), transfer });

describe("direction", () => {
	it("follows the sign of a standard transaction, zero being an expense", () => {
		expect(direction(tx(-2000))).toBe("expense");
		expect(direction(tx(3000))).toBe("income");
		expect(direction(tx(0))).toBe("expense");
	});

	it("makes both sides of an internal move and of a card payment transfers", () => {
		expect(direction(tx(-50000, { kind: "internal_move" }))).toBe("transfer");
		expect(direction(tx(50000, { kind: "internal_move" }))).toBe("transfer");
		expect(direction(tx(-30000, { kind: "credit_card_payment" }))).toBe("transfer");
		expect(direction(tx(30000, { kind: "credit_card_payment" }))).toBe("transfer");
	});

	it("keeps the outflow of a loan payment or an investment contribution an expense", () => {
		expect(direction(tx(-40000, { kind: "loan_payment" }))).toBe("expense");
		expect(direction(tx(-40000, { kind: "investment_contribution" }))).toBe("expense");
		expect(direction(tx(40000, { kind: "loan_payment" }))).toBe("transfer");
		expect(direction(tx(40000, { kind: "investment_contribution" }))).toBe("transfer");
	});

	it("ignores exclusion and account settings", () => {
		const excluded = { ...tx(-2000), excluded: true, accountExcludedFromReports: true };

		expect(direction(excluded)).toBe("expense");
	});
});

const counted = (value: CashFlowTransaction, excluded = false, pending = false) =>
	countsInCashFlow({ ...value, excluded, pending });

describe("countsInCashFlow", () => {
	it("counts income and expenses, not an excluded row nor a transfer side", () => {
		expect(counted(tx(-2000))).toBe(true);
		expect(counted(tx(3000))).toBe(true);
		expect(counted(tx(-2000), true)).toBe(false);
		expect(counted(tx(-50000, { kind: "internal_move" }))).toBe(false);
		expect(counted(tx(30000, { kind: "credit_card_payment" }))).toBe(false);
		expect(counted(tx(-40000, { kind: "loan_payment" }))).toBe(true);
		expect(counted(tx(40000, { kind: "investment_contribution" }))).toBe(false);
		expect(counted(tx(-40000, { kind: "investment_contribution" }), true)).toBe(false);
	});

	it("never counts a pending row", () => {
		expect(counted(tx(-1200), false, true)).toBe(false);
		expect(counted(tx(3000), false, true)).toBe(false);
	});
});

const category = (
	id: string,
	kind: CashFlowCategory["kind"] = "expense",
	parentId: string | null = null,
): CashFlowCategory => ({ id, name: id, kind, color: `#${id}`, parentId });

const row = (categoryId: string | null, amount: number): CashFlowRow => ({
	categoryId,
	amount: toMinorUnits(amount),
});

describe("cashFlowBreakdown", () => {
	const courses = category("Courses");
	const bio = category("Bio", "expense", "Courses");
	const salaire = category("Salaire", "income");
	const primes = category("Primes", "income");
	const loisirs = category("Loisirs");
	const all = [courses, bio, salaire, primes, loisirs];

	it("rolls a sub-category up into its parent", () => {
		const result = cashFlowBreakdown([row("Courses", -3000), row("Bio", -2000)], all);

		expect(result.expenses).toBe(-5000);
		expect(result.lines.expense).toEqual([
			{ categoryId: "Courses", name: "Courses", color: "#Courses", amount: -5000, share: 1 },
		]);
	});

	it("lowers a category and its group by a refund", () => {
		const result = cashFlowBreakdown([row("Courses", -8000), row("Courses", 2000)], all);

		expect(result).toEqual({
			income: 0,
			expenses: -6000,
			lines: {
				income: [],
				expense: [
					{ categoryId: "Courses", name: "Courses", color: "#Courses", amount: -6000, share: 1 },
				],
			},
		});
	});

	it("splits uncategorised rows by sign into « Sans catégorie » on each side", () => {
		const result = cashFlowBreakdown([row(null, 10000), row(null, -4000)], all);

		expect(result).toEqual({
			income: 10000,
			expenses: -4000,
			lines: {
				income: [{ categoryId: null, name: null, color: null, amount: 10000, share: 1 }],
				expense: [{ categoryId: null, name: null, color: null, amount: -4000, share: 1 }],
			},
		});
	});

	it("counts a row of an unknown category as uncategorised", () => {
		const result = cashFlowBreakdown([row("gone", -1000)], all);

		expect(result.lines.expense).toEqual([
			{ categoryId: null, name: null, color: null, amount: -1000, share: 1 },
		]);
	});

	it("files a line by its category's kind, not its sign, and sorts by size", () => {
		const result = cashFlowBreakdown(
			[
				row("Loisirs", -1000),
				row("Courses", -3000),
				row(null, -1000),
				row("Salaire", 200000),
				row("Primes", -500),
			],
			all,
		);

		expect(result.income).toBe(199500);
		expect(result.lines.income.map((line) => [line.categoryId, line.amount])).toEqual([
			["Salaire", 200000],
			["Primes", -500],
		]);
		expect(result.expenses).toBe(-5000);
		expect(result.lines.expense.map((line) => [line.categoryId, line.share])).toEqual([
			["Courses", 0.6],
			["Loisirs", 0.2],
			[null, 0.2],
		]);
	});

	it("orders lines of the same size by name, « Sans catégorie » last", () => {
		const forward = cashFlowBreakdown(
			[row(null, -1000), row("Loisirs", -1000), row("Courses", -1000)],
			all,
		);
		const backward = cashFlowBreakdown(
			[row("Courses", -1000), row("Loisirs", -1000), row(null, -1000)],
			all,
		);

		expect(forward.lines.expense.map((line) => line.categoryId)).toEqual([
			"Courses",
			"Loisirs",
			null,
		]);
		expect(backward).toEqual(forward);
	});

	it("drops a line that sums to zero", () => {
		const result = cashFlowBreakdown([row("Courses", -5000), row("Courses", 5000)], all);

		expect(result).toEqual({ income: 0, expenses: 0, lines: { income: [], expense: [] } });
	});

	it("gives no share when a group sums to zero", () => {
		const result = cashFlowBreakdown([row("Salaire", 5000), row("Primes", -5000)], all);

		expect(result.income).toBe(0);
		expect(result.lines.income.map((line) => [line.categoryId, line.share])).toEqual([
			["Primes", null],
			["Salaire", null],
		]);
	});

	it("is empty without rows", () => {
		expect(cashFlowBreakdown([], all)).toEqual({
			income: 0,
			expenses: 0,
			lines: { income: [], expense: [] },
		});
	});
});
