import type { TempDatabase } from "../testing/temp-database.ts";
import type { NewAccountInput } from "./ledger/accounts.ts";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatMoney, toMinorUnits } from "@archant/data/money";
import { users } from "@archant/data/schema/auth";
import { categories } from "@archant/data/schema/categories";

import { quantity as qty, tradePrice } from "../testing/decimals.ts";
import { insertSecurity } from "../testing/prices.ts";
import { createTempDatabase } from "../testing/temp-database.ts";
import { saveBudget, saveCategoryBudget } from "./budgets.ts";
import { createAccount } from "./ledger/accounts.ts";
import { updateTransaction } from "./ledger/edits.ts";
import { ingest } from "./ledger/ingest.ts";
import { recordTrade } from "./ledger/trades.ts";
import { getReportsCsv, getReportsPage } from "./reports-page.ts";

let temp: TempDatabase;
const deps = () => ({ db: temp.db, timeZone: "Europe/Paris" });

beforeEach(async () => {
	temp = await createTempDatabase();
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-11-06T10:00:00Z"));
});

afterEach(async () => {
	vi.useRealTimers();
	await temp.dispose();
});

async function account(overrides: Partial<NewAccountInput> = {}) {
	const created = await createAccount(
		deps(),
		{
			name: "Courant",
			type: "depository",
			subtype: "checking",
			currency: "EUR",
			openingBalance: toMinorUnits(100_000),
			openingDate: "2026-09-01",
			...overrides,
		},
		{ origin: "user" },
	);

	return created.id;
}

async function book(
	accountId: string,
	date: string,
	amount: number,
	{ categoryId, pending = false }: { categoryId?: string; pending?: boolean } = {},
) {
	const { created } = await ingest(
		deps(),
		accountId,
		{
			transactions: [
				{
					externalId: null,
					date,
					amount: toMinorUnits(amount),
					currency: "EUR",
					label: "CB",
					reference: null,
					notes: null,
					pending,
				},
			],
			balance: null,
			rejected: [],
		},
		{ manual: true },
		{ origin: "user" },
	);
	const id = created[0] ?? "";

	if (categoryId !== undefined) {
		await updateTransaction(deps(), id, { categoryId }, { origin: "user" });
	}

	return id;
}

async function category(name: string, parentId: string | null = null) {
	const id = crypto.randomUUID();
	await temp.db.insert(categories).values({
		id,
		name,
		color: "#e99537",
		icon: "tag",
		parentId,
		createdAt: 0,
		updatedAt: 0,
	});

	return id;
}

const page = (query: Partial<Parameters<typeof getReportsPage>[1]> = {}) =>
	getReportsPage(deps(), {
		periodType: "monthly",
		startDate: undefined,
		endDate: undefined,
		...query,
	});

describe("getReportsPage", () => {
	it("reads the current month by default, with Sure's period and navigation", async () => {
		const report = await page();

		expect(report.period).toMatchObject({
			from: "2026-11-01",
			to: "2026-11-30",
			previous: { from: "2026-10-02", to: "2026-10-31" },
		});
		expect(report.navigation).toMatchObject({ atLatest: true });
		expect(report).toMatchObject({ hasTransactions: false, hasAccounts: false });
	});

	it("compares income and expenses with the period before, 0 % without a previous figure", async () => {
		const checking = await account();
		await book(checking, "2026-11-02", 10_000);
		await book(checking, "2026-10-10", -5_000);
		await book(checking, "2026-11-03", -7_500);

		const { summary, hasTransactions, hasAccounts } = await page();

		expect(summary).toMatchObject({
			income: 10_000,
			expenses: 7_500,
			netSavings: 2_500,
			incomeChange: 0,
			expenseChange: 50,
		});
		expect({ hasTransactions, hasAccounts }).toEqual({ hasTransactions: true, hasAccounts: true });
	});

	it("rounds a change to one decimal, half away from zero", async () => {
		const checking = await account();
		await book(checking, "2026-10-10", -3_000);
		await book(checking, "2026-11-03", -2_000);

		expect((await page()).summary.expenseChange).toBe(-33.3);
	});

	it("shows the budget card for a monthly report of the current month only, over the categories' amounts", async () => {
		const checking = await account();
		const food = await category("Alimentation");
		await saveBudget(deps(), "2026-11", { budgetedSpending: "400", expectedIncome: "0" });
		await saveCategoryBudget(deps(), "2026-11", food, { budgetedSpending: "200" });
		await book(checking, "2026-11-03", -5_000);

		// Sure divides by `allocated_spending`, 200 €, not the 400 € total.
		expect((await page()).summary.budgetPercent).toBe(25);
		expect((await page({ periodType: "quarterly" })).summary.budgetPercent).toBeNull();
		expect(
			(await page({ startDate: "2026-10-01", endDate: "2026-10-31" })).summary.budgetPercent,
		).toBeNull();
	});

	it("reads 0 % for the current month while no category has an amount, whatever the total", async () => {
		const checking = await account();
		await saveBudget(deps(), "2026-11", { budgetedSpending: "200", expectedIncome: "0" });
		await book(checking, "2026-11-03", -5_000);

		expect((await page()).summary.budgetPercent).toBe(0);
	});

	it("reads 0 % for the current month without a budget", async () => {
		await account();

		expect((await page()).summary.budgetPercent).toBe(0);
	});

	it("starts the trends at the first of the start's month, the last row cut to the end", async () => {
		const checking = await account();
		await book(checking, "2026-10-03", 20_000);
		await book(checking, "2026-10-20", -5_000);
		await book(checking, "2026-11-04", -1_000);

		const { trends, summary } = await page({
			periodType: "custom",
			startDate: "2026-10-15",
			endDate: "2026-11-06",
		});

		expect(trends).toEqual([
			{
				month: "2026-10",
				from: "2026-10-01",
				to: "2026-10-31",
				current: false,
				income: 20_000,
				expenses: 5_000,
				net: 15_000,
			},
			{
				month: "2026-11",
				from: "2026-11-01",
				to: "2026-11-06",
				current: true,
				income: 0,
				expenses: 1_000,
				net: -1_000,
			},
		]);
		expect(summary.income).toBe(0);
	});

	it("breaks the activity down with pending rows, trades and sub-categories", async () => {
		const checking = await account();
		const brokerage = await account({ name: "CTO", type: "investment", subtype: "brokerage" });
		const food = await category("Alimentation");
		const groceries = await category("Courses", food);
		await book(checking, "2026-11-02", -3_000, { categoryId: food });
		await book(checking, "2026-11-03", -2_000, { categoryId: groceries });
		await book(checking, "2026-11-04", -1_000, { categoryId: groceries, pending: true });
		await book(checking, "2026-11-04", -500);
		await book(checking, "2026-11-05", 9_000);
		const security = await insertSecurity(temp.db, {}, { held: false });
		await recordTrade(
			deps(),
			brokerage,
			{
				side: "buy",
				security: { source: "known", id: security },
				date: "2026-11-05",
				quantity: qty("1"),
				price: tradePrice("40"),
				fee: toMinorUnits(0),
			},
			{ origin: "user" },
		);

		const { breakdown, summary } = await page();

		expect(breakdown.expense).toEqual([
			expect.objectContaining({
				kind: "category",
				categoryId: food,
				total: 6_000,
				count: 3,
				hasTransactions: true,
				subcategories: [
					expect.objectContaining({
						categoryId: groceries,
						name: "Courses",
						total: 3_000,
						count: 2,
					}),
				],
			}),
			expect.objectContaining({
				kind: "other_investments",
				name: null,
				total: 4_000,
				count: 1,
				hasTransactions: false,
			}),
			expect.objectContaining({ kind: "uncategorized", total: 500, count: 1 }),
		]);
		expect(breakdown.income).toEqual([
			expect.objectContaining({ kind: "uncategorized", total: 9_000, count: 1, subcategories: [] }),
		]);
		// The summary counts neither the pending row nor the trade (AD-9).
		expect(summary.expenses).toBe(5_500);
	});

	it("gives today's net worth, the period's change and the type groups with a balance", async () => {
		const checking = await account({ openingDate: "2026-09-01" });
		await account({
			name: "Vide",
			type: "depository",
			subtype: "savings",
			openingBalance: toMinorUnits(0),
		});
		await account({
			name: "Carte",
			type: "credit_card",
			subtype: null,
			openingBalance: toMinorUnits(30_000),
		});
		await book(checking, "2026-10-15", -20_000);

		const { netWorth } = await page({ periodType: "quarterly" });

		expect(netWorth).toMatchObject({
			netWorth: 50_000,
			assets: 80_000,
			liabilities: 30_000,
			change: { amount: -20_000 },
			groups: {
				asset: [{ type: "depository", total: 80_000 }],
				liability: [{ type: "credit_card", total: 30_000 }],
			},
		});
		expect(netWorth.series.map((point) => point.date)).toEqual([
			"2026-10-01",
			"2026-11-01",
			"2026-11-06",
		]);
		expect(netWorth.series.at(-1)).toMatchObject({ netWorth: 50_000 });
	});
});

describe("getReportsCsv", () => {
	it("writes one flat row per category and side, by month, with Sure's totals", async () => {
		const userId = crypto.randomUUID();
		await temp.db
			.insert(users)
			.values({ id: userId, name: "A", email: "a@example.test", role: "admin", locale: "en" });
		const checking = await account();
		const food = await category("Food");
		const groceries = await category("Groceries", food);
		const formula = await category("=HYPERLINK(1)");
		await book(checking, "2026-10-05", -1_000, { categoryId: food });
		await book(checking, "2026-11-02", -2_500, { categoryId: groceries });
		await book(checking, "2026-11-03", -400, { categoryId: groceries, pending: true });
		await book(checking, "2026-11-04", -300);
		await book(checking, "2026-10-20", 50_000, { categoryId: formula });

		const { fileName, body } = await getReportsCsv(
			deps(),
			{ periodType: "custom", startDate: "2026-10-01", endDate: "2026-11-30" },
			{ userId, acceptLanguage: "fr-FR" },
		);

		expect(fileName).toBe("transactions_breakdown_20261001_to_20261130.csv");
		expect(body).toBe(
			[
				"Category,Oct 2026,Nov 2026,Total",
				"INCOME,,,",
				"'=HYPERLINK(1),€500.00,€0.00,€500.00",
				"TOTAL INCOME,€500.00,€0.00,€500.00",
				"",
				"EXPENSES,,,",
				"Groceries,€0.00,€29.00,€29.00",
				"Food,€10.00,€0.00,€10.00",
				"Uncategorized,€0.00,€3.00,€3.00",
				"TOTAL EXPENSES,€10.00,€32.00,€42.00",
				"",
			].join("\n"),
		);
	});

	it("writes amounts in the browser's language for a user who chose none", async () => {
		const userId = crypto.randomUUID();
		await temp.db
			.insert(users)
			.values({ id: userId, name: "A", email: "a@example.test", role: "admin" });
		const checking = await account();
		await book(checking, "2026-11-02", -123_456);

		const { body } = await getReportsCsv(
			deps(),
			{ periodType: "monthly", startDate: undefined, endDate: undefined },
			{ userId, acceptLanguage: "fr-CA,fr;q=0.9" },
		);

		const amount = `"${formatMoney({ amount: toMinorUnits(123_456), currency: "EUR" }, "fr-FR")}"`;

		expect(body.split("\n")).toEqual([
			"Category,Nov 2026,Total",
			"EXPENSES,,",
			`Uncategorized,${amount},${amount}`,
			`TOTAL EXPENSES,${amount},${amount}`,
			"",
		]);
		expect(amount).toContain("1\u202f234,56");
	});
});
