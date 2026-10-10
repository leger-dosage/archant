import type { CashFlowCategory, CashFlowRow, CashFlowTransaction } from "./cash-flow.ts";

import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import {
	countsInCashFlow,
	direction,
	grossCashFlow,
	netCashFlow,
	recurringDirection,
} from "./cash-flow.ts";

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

	it("makes the outflow of a loan payment or an investment contribution a transfer, as Sure's type filter, where it was an expense", () => {
		expect(direction(tx(-40000, { kind: "loan_payment" }))).toBe("transfer");
		expect(direction(tx(-40000, { kind: "investment_contribution" }))).toBe("transfer");
		expect(direction(tx(40000, { kind: "loan_payment" }))).toBe("transfer");
		expect(direction(tx(40000, { kind: "investment_contribution" }))).toBe("transfer");
	});

	it("ignores exclusion and account settings", () => {
		const excluded = { ...tx(-2000), excluded: true, accountExcludedFromReports: true };

		expect(direction(excluded)).toBe("expense");
	});
});

describe("recurringDirection", () => {
	it("keeps the outflow of a loan payment or an investment contribution an expense, every other side a transfer", () => {
		expect(recurringDirection(tx(-40000, { kind: "loan_payment" }))).toBe("expense");
		expect(recurringDirection(tx(-40000, { kind: "investment_contribution" }))).toBe("expense");
		expect(recurringDirection(tx(40000, { kind: "loan_payment" }))).toBe("transfer");
		expect(recurringDirection(tx(-50000, { kind: "internal_move" }))).toBe("transfer");
		expect(recurringDirection(tx(3000))).toBe("income");
		expect(recurringDirection(tx(0))).toBe("expense");
	});
});

const counted = (value: CashFlowTransaction, excluded = false, pending = false) =>
	countsInCashFlow({ ...value, excluded, pending });

describe("countsInCashFlow", () => {
	it("counts income and expenses and a loan payment's or contribution's outflow, not an excluded row nor another transfer side", () => {
		expect(counted(tx(-2000))).toBe(true);
		expect(counted(tx(3000))).toBe(true);
		expect(counted(tx(-2000), true)).toBe(false);
		expect(counted(tx(-50000, { kind: "internal_move" }))).toBe(false);
		expect(counted(tx(30000, { kind: "credit_card_payment" }))).toBe(false);
		expect(counted(tx(-40000, { kind: "loan_payment" }))).toBe(true);
		expect(counted(tx(-40000, { kind: "investment_contribution" }))).toBe(true);
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
): CashFlowCategory => ({ id, name: id, kind, color: `#${id}`, icon: "tag", parentId });

const row = (categoryId: string | null, amount: number): CashFlowRow => ({
	categoryId,
	amount: toMinorUnits(amount),
});

const line = (categoryId: string | null, amount: number, share: number | null = 1) => ({
	categoryId,
	name: categoryId,
	color: categoryId === null ? null : `#${categoryId}`,
	icon: categoryId === null ? null : "tag",
	amount,
	share,
});

const courses = category("Courses");
const bio = category("Bio", "expense", "Courses");
const salaire = category("Salaire", "income");
const primes = category("Primes", "income");
const loisirs = category("Loisirs");
const all = [courses, bio, salaire, primes, loisirs];

const both = (rows: CashFlowRow[]) => {
	const gross = grossCashFlow(rows, all);

	return { gross, net: netCashFlow(gross) };
};

describe("grossCashFlow and netCashFlow", () => {
	it("keeps a refund as income in its category, gross, where it lowered the expense; net, the expense line is −70 €", () => {
		const { gross, net } = both([row("Courses", -10000), row("Courses", 3000)]);

		expect(gross).toMatchObject({
			income: 3000,
			expenses: -10000,
			lines: { income: [line("Courses", 3000)], expense: [line("Courses", -10000)] },
		});
		expect(net).toEqual({
			income: 0,
			expenses: -7000,
			lines: { income: [], expense: [line("Courses", -7000)] },
		});
	});

	it("makes a category that took in more than it spent a net income line of +30 €, where it was an expense line", () => {
		const { gross, net } = both([row("Courses", -2000), row("Courses", 5000)]);

		expect(gross).toMatchObject({ income: 5000, expenses: -2000 });
		expect(net).toEqual({
			income: 3000,
			expenses: 0,
			lines: { income: [line("Courses", 3000)], expense: [] },
		});
	});

	it("counts what an income-kind category spends as an expense of −40 €, where it lowered income", () => {
		const { gross, net } = both([row("Salaire", -4000)]);

		expect(gross).toMatchObject({
			income: 0,
			expenses: -4000,
			lines: { income: [], expense: [line("Salaire", -4000)] },
		});
		expect(net).toEqual({
			income: 0,
			expenses: -4000,
			lines: { income: [], expense: [line("Salaire", -4000)] },
		});
	});

	it("keeps « Sans catégorie »'s two signs apart gross and nets them to an income line of +20 €", () => {
		const { gross, net } = both([row(null, -8000), row(null, 10000)]);

		expect(gross).toMatchObject({
			income: 10000,
			expenses: -8000,
			lines: { income: [line(null, 10000)], expense: [line(null, -8000)] },
		});
		expect(net).toEqual({
			income: 2000,
			expenses: 0,
			lines: { income: [line(null, 2000)], expense: [] },
		});
	});

	it("rolls a sub-category up into its parent and lists its own rows per side", () => {
		const { gross, net } = both([row("Courses", -3000), row("Bio", -2000), row("Bio", 500)]);

		expect(gross.lines.expense).toEqual([line("Courses", -5000)]);
		expect(gross.lines.income).toEqual([line("Courses", 500)]);
		expect([...gross.subcategories.expense]).toEqual([
			["Courses", [{ categoryId: "Bio", name: "Bio", amount: -2000 }]],
		]);
		expect([...gross.subcategories.income]).toEqual([
			["Courses", [{ categoryId: "Bio", name: "Bio", amount: 500 }]],
		]);
		expect(net.lines.expense).toEqual([line("Courses", -4500)]);
	});

	it("counts a row of an unknown category as uncategorised", () => {
		expect(grossCashFlow([row("gone", -1000)], all).lines.expense).toEqual([line(null, -1000)]);
	});

	it("sorts each side by size, with shares, by name among equals and « Sans catégorie » last", () => {
		const { gross, net } = both([
			row("Loisirs", -1000),
			row("Courses", -3000),
			row(null, -1000),
			row("Salaire", 200000),
			row("Primes", -500),
		]);

		expect(gross.income).toBe(200000);
		expect(gross.expenses).toBe(-5500);
		expect(net.lines.expense.map((item) => [item.categoryId, item.amount])).toEqual([
			["Courses", -3000],
			["Loisirs", -1000],
			[null, -1000],
			["Primes", -500],
		]);
		expect(gross.lines.expense.map((item) => item.share)).toEqual([
			3000 / 5500,
			1000 / 5500,
			1000 / 5500,
			500 / 5500,
		]);
		const reversed = grossCashFlow(
			[row(null, -1000), row("Loisirs", -1000), row("Courses", -1000)],
			all,
		);
		expect(reversed.lines.expense.map((item) => item.categoryId)).toEqual([
			"Courses",
			"Loisirs",
			null,
		]);
	});

	it("drops a net line that sums to zero, where gross keeps both sides", () => {
		const { gross, net } = both([row("Courses", -5000), row("Courses", 5000)]);

		expect(gross.lines.income).toHaveLength(1);
		expect(gross.lines.expense).toHaveLength(1);
		expect(net).toEqual({ income: 0, expenses: 0, lines: { income: [], expense: [] } });
	});

	it("is empty without rows", () => {
		expect(both([])).toEqual({
			gross: {
				income: 0,
				expenses: 0,
				lines: { income: [], expense: [] },
				subcategories: { income: new Map(), expense: new Map() },
			},
			net: { income: 0, expenses: 0, lines: { income: [], expense: [] } },
		});
	});

	it("gives each parent its sub-categories' own sums per side, largest first then by name, never the parent's rows nor a zero", () => {
		const maison = category("Maison");
		const children = ["Jardin", "Travaux", "Meubles", "Bois"].map((id) =>
			category(id, "expense", "Maison"),
		);
		const orphan = category("Orphelin", "expense", "gone");
		const { subcategories } = grossCashFlow(
			[
				row("Maison", -80000),
				row("Meubles", -3000),
				row("Jardin", -9000),
				row("Travaux", -9000),
				row("Travaux", 2000),
				row("Orphelin", -100),
				row("Bois", 0),
				row(null, -700),
			],
			[maison, ...children, orphan],
		);

		expect([...subcategories.expense]).toEqual([
			[
				"Maison",
				[
					{ categoryId: "Jardin", name: "Jardin", amount: -9000 },
					{ categoryId: "Travaux", name: "Travaux", amount: -9000 },
					{ categoryId: "Meubles", name: "Meubles", amount: -3000 },
				],
			],
		]);
		expect([...subcategories.income]).toEqual([
			["Maison", [{ categoryId: "Travaux", name: "Travaux", amount: 2000 }]],
		]);
	});
});
