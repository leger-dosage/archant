import type { TempDatabase } from "../testing/temp-database.ts";
import type { NewAccountInput } from "./ledger/accounts.ts";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toMicros } from "@archant/data/micros";
import { formatMoney, toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { users } from "@archant/data/schema/auth";
import { categories } from "@archant/data/schema/categories";
import { securityPrices } from "@archant/data/schema/securities";

import { quantity as qty, tradePrice } from "../testing/decimals.ts";
import { removeReportSnapshots, seedReportLock } from "../testing/ledger.ts";
import { insertSecurity } from "../testing/prices.ts";
import { createTempDatabase } from "../testing/temp-database.ts";
import { saveBudget, saveCategoryBudget } from "./budgets.ts";
import { createAccount } from "./ledger/accounts.ts";
import { updateTransaction } from "./ledger/edits.ts";
import { revalueHoldings } from "./ledger/holdings.ts";
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

describe("report investments", () => {
	it("hides both sections without investments and shows cash-only accounts with unavailable returns", async () => {
		expect((await page()).investments).toEqual({ available: false });
		await account({ type: "investment", subtype: "pea" });
		const report = await page();
		expect(report.investments).toMatchObject({
			available: true,
			value: 100_000,
			holdings: [],
			totalReturn: null,
			periodReturn: null,
		});
		expect(report.investmentFlows.available).toBe(false);
	});
	it("calculates period market return, gross realized gains and distinct labeled funding", async () => {
		const { id, trade } = await investmentFixture();
		await trade("buy", "2026-10-01", "10", "10", 100);
		await trade("sell", "2026-11-02", "4", "15", 50);
		const funding = await book(id, "2026-11-03", 5000);
		await updateTransaction(
			deps(),
			funding,
			{ investmentActivityLabel: "Contribution" },
			{ origin: "user" },
		);
		const report = await page();
		expect(report.investments).toMatchObject({
			available: true,
			value: 109850,
			periodReturn: { gain: 4950, percent: "4.954955", trend: "up" },
			activity: { contributions: 0, withdrawals: 5950 },
			gainsByTaxTreatment: [
				{ treatment: "taxable", unrealizedGain: 2940, realizedGain: 1960, totalGain: 4900 },
			],
		});
		expect(report.investmentFlows).toMatchObject({
			available: true,
			contributions: 5000,
			withdrawals: 0,
			netFlow: 5000,
		});
	});
});

async function investmentFixture() {
	const id = await account({ type: "investment", subtype: "brokerage" });
	const security = await insertSecurity(temp.db, {}, { held: false });
	const trade = async (
		side: "buy" | "sell",
		date: string,
		quantity: string,
		price: string,
		fee = 0,
	) => {
		vi.setSystemTime(new Date(Date.now() + 1));
		return recordTrade(
			deps(),
			id,
			{
				side,
				date,
				quantity: qty(quantity),
				price: tradePrice(price),
				fee: toMinorUnits(fee),
				security: { source: "known", id: security },
			},
			{ origin: "user" },
		);
	};
	const realized = async () => {
		const report = await page();
		if (!report.investments.available) {
			throw new Error("Expected investments");
		}
		return report.investments.gainsByTaxTreatment.find((group) =>
			group.sales.some((sale) => sale.accountId === id),
		);
	};
	return { id, security, trade, realized };
}

describe("Sure historical sale basis, policy A", () => {
	it("uses the purchase average on a full sale, ignoring its purchase and sale fees", async () => {
		const { trade, realized } = await investmentFixture();
		await trade("buy", "2026-10-01", "10", "10", 1000);
		await trade("sell", "2026-11-02", "10", "20", 200);
		expect(await realized()).toMatchObject({
			realizedGain: 10000,
			holdings: [],
			sales: [{ gain: 10000 }],
		});
	});
	it("takes the end-of-day positive snapshot after a later same-day purchase", async () => {
		const { trade, realized } = await investmentFixture();
		await trade("buy", "2026-10-01", "10", "10");
		await trade("sell", "2026-11-02", "10", "20");
		await trade("buy", "2026-11-02", "10", "30");
		expect(await realized()).toMatchObject({ realizedGain: -10000, sales: [{ gain: -10000 }] });
	});
	it("includes purchases from a closed position in a later full-sale fallback", async () => {
		const { trade, realized } = await investmentFixture();
		await trade("buy", "2026-10-01", "10", "10");
		await trade("sell", "2026-10-02", "10", "20");
		await trade("buy", "2026-10-03", "10", "30");
		await trade("sell", "2026-11-02", "10", "40");
		expect(await realized()).toMatchObject({ realizedGain: 20000, sales: [{ gain: 20000 }] });
	});
	it("averages later same-day purchases when that day's final snapshot is zero", async () => {
		const { trade, realized } = await investmentFixture();
		await trade("buy", "2026-10-01", "10", "10");
		await trade("sell", "2026-11-02", "10", "20");
		await trade("buy", "2026-11-02", "10", "30");
		await trade("sell", "2026-11-02", "10", "40");
		expect(await realized()).toMatchObject({
			realizedGain: 20000,
			sales: [{ gain: 0 }, { gain: 20000 }],
		});
	});
	it("leaves a sale unknown without a snapshot, even with purchases", async () => {
		const { id, trade, realized } = await investmentFixture();
		await trade("buy", "2026-10-01", "10", "10");
		await trade("sell", "2026-11-02", "10", "20");
		await removeReportSnapshots(deps(), id, "2026-11-02");
		expect(await realized()).toMatchObject({ realizedGain: 0, sales: [{ gain: null }] });
	});
	it("leaves a short sale without purchases unknown", async () => {
		const { trade, realized } = await investmentFixture();
		await trade("sell", "2026-11-02", "1", "20");
		expect(await realized()).toMatchObject({ realizedGain: 0, sales: [{ gain: null }] });
	});
	it("knows a free purchase's zero average", async () => {
		const { trade, realized } = await investmentFixture();
		await trade("buy", "2026-10-01", "10", "0");
		await trade("sell", "2026-11-02", "10", "20");
		expect(await realized()).toMatchObject({ realizedGain: 20000, sales: [{ gain: 20000 }] });
	});
	it("honors a recorded zero lock only from locked_on through the sale that ends it", async () => {
		const { id, security, trade, realized } = await investmentFixture();
		await trade("buy", "2026-10-01", "10", "10");
		await trade("sell", "2026-11-01", "2", "20");
		await trade("sell", "2026-11-03", "8", "20");
		await trade("buy", "2026-11-04", "10", "30");
		await trade("sell", "2026-11-05", "2", "40");
		await seedReportLock(deps(), {
			accountId: id,
			securityId: security,
			costBasis: toMicros(0),
			lockedOn: "2026-11-02",
		});
		expect(await realized()).toMatchObject({
			realizedGain: 20000,
			sales: [{ gain: 2000 }, { gain: 16000 }, { gain: 2000 }],
		});
	});
});

describe("investment period boundaries and inclusion", () => {
	it("takes capital strictly before the period, without a first-day substitute", async () => {
		const id = await account({ type: "investment", subtype: "pea", openingDate: "2026-11-01" });
		const security = await insertSecurity(temp.db, {}, { held: false });
		await recordTrade(
			deps(),
			id,
			{
				side: "buy",
				date: "2026-11-02",
				quantity: qty("1"),
				price: tradePrice("10"),
				fee: toMinorUnits(0),
				security: { source: "known", id: security },
			},
			{ origin: "user" },
		);
		expect((await page()).investments).toMatchObject({ available: true, periodReturn: null });
	});
	it("does not revive a sold-out holding and carries materialized values into a future empty period", async () => {
		const { trade } = await investmentFixture();
		await trade("buy", "2026-10-01", "10", "10");
		await trade("sell", "2026-11-02", "10", "20");
		expect((await page()).investments).toMatchObject({
			holdings: [],
			periodReturn: { gain: 10000, percent: "10" },
		});
		expect(
			(await page({ periodType: "custom", startDate: "2027-01-01", endDate: "2027-01-31" }))
				.investments,
		).toMatchObject({ holdings: [], periodReturn: null });
	});
	it("counts price changes but no dividends or cash funding as market gains", async () => {
		const { id, security, trade } = await investmentFixture();
		await trade("buy", "2026-10-01", "10", "10");
		await recordTrade(
			deps(),
			id,
			{
				side: "dividend",
				date: "2026-11-03",
				amount: toMinorUnits(1000),
				security: { source: "known", id: security },
			},
			{ origin: "user" },
		);
		await book(id, "2026-11-04", 20000);
		await temp.db.insert(securityPrices).values({
			securityId: security,
			date: "2026-11-05",
			price: toMicros(15_000_000),
			currency: "EUR",
			source: "manual",
		});
		await temp.db.transaction(async (tx) =>
			revalueHoldings(tx, security, "2026-11-05", deps().timeZone, { origin: "user" }),
		);
		expect((await page()).investments).toMatchObject({
			totalReturn: { gain: 5000 },
			periodReturn: { gain: 5000, percent: "5" },
			activity: { contributions: 0, withdrawals: 0, trades: 1 },
		});
		expect(
			(await page({ periodType: "custom", startDate: "2027-01-01", endDate: "2027-01-31" }))
				.investments,
		).toMatchObject({ periodReturn: { gain: 0, percent: "0" } });
	});
	it("names foreign investments and excludes inactive and excluded accounts", async () => {
		const foreign = await account({
			name: "Dollars",
			type: "investment",
			subtype: "pea",
			currency: "USD",
		});
		await account({ type: "investment", subtype: "pea", excludedFromReports: true });
		const inactive = await account({ type: "investment", subtype: "pea" });
		await temp.db.update(accounts).set({ active: false }).where(eq(accounts.id, inactive));
		expect((await page()).investments).toMatchObject({
			available: true,
			value: 0,
			accounts: [],
			holdings: [],
			leftOut: [{ id: foreign, name: "Dollars", currency: "USD" }],
		});
	});
});

it("keeps a revaluation-only October return after a full sale in November", async () => {
	const { security, trade } = await investmentFixture();
	await trade("buy", "2026-09-15", "10", "10");
	await temp.db.insert(securityPrices).values({
		securityId: security,
		date: "2026-10-15",
		price: toMicros(15_000_000),
		currency: "EUR",
		source: "manual",
	});
	await temp.db.transaction(async (tx) =>
		revalueHoldings(tx, security, "2026-10-15", deps().timeZone, { origin: "user" }),
	);
	await trade("sell", "2026-11-02", "10", "20");
	expect(
		(await page({ startDate: "2026-10-01", endDate: "2026-10-31" })).investments,
	).toMatchObject({
		holdings: [],
		activity: { trades: 0 },
		periodReturn: { gain: 5000, percent: "5", trend: "up" },
	});
});

it("groups all four treatments in Sure order with matching account details and unknown gains", async () => {
	const fixtures = await (
		[
			{ treatment: "tax_advantaged", type: "investment", subtype: "pea", rank: 4 },
			{ treatment: "tax_exempt", type: "crypto", subtype: "exchange", rank: 3 },
			{ treatment: "tax_deferred", type: "investment", subtype: "pension", rank: 2 },
			{ treatment: "taxable", type: "investment", subtype: "brokerage", rank: 1 },
		] as const
	).reduce(async (previous, input) => {
		const rows = await previous;
		const accountId = await account({
			type: input.type,
			subtype: input.subtype,
			details: input.type === "crypto" ? { taxTreatment: "tax_exempt" } : null,
		});
		const securityId = await insertSecurity(
			temp.db,
			{ name: input.treatment, isin: null, ticker: null },
			{ held: false },
		);
		const security = { source: "known", id: securityId } as const;
		await recordTrade(
			deps(),
			accountId,
			{
				side: "buy",
				date: "2026-09-15",
				quantity: qty("10"),
				price: tradePrice(String(input.rank * 10)),
				fee: toMinorUnits(0),
				security,
			},
			{ origin: "user" },
		);
		const sale = await recordTrade(
			deps(),
			accountId,
			{
				side: "sell",
				date: "2026-11-02",
				quantity: qty("2"),
				price: tradePrice(String(input.rank * 11)),
				fee: toMinorUnits(0),
				security,
			},
			{ origin: "user" },
		);
		return [...rows, { ...input, accountId, securityId, saleId: sale.id }];
	}, Promise.resolve<{ treatment: string; rank: number; accountId: string; securityId: string; saleId: string }[]>([]));
	const exempt = fixtures.find((fixture) => fixture.treatment === "tax_exempt");
	if (exempt === undefined) {
		throw new Error("Expected an exempt account");
	}
	const unknownId = await insertSecurity(
		temp.db,
		{ name: "Unknown basis", isin: null, ticker: null },
		{ held: false },
	);
	const unknownSale = await recordTrade(
		deps(),
		exempt.accountId,
		{
			side: "sell",
			date: "2026-11-03",
			quantity: qty("1"),
			price: tradePrice("10"),
			fee: toMinorUnits(0),
			security: { source: "known", id: unknownId },
		},
		{ origin: "user" },
	);
	const report = await page();
	if (!report.investments.available) {
		throw new Error("Expected investment figures");
	}
	expect(
		report.investments.gainsByTaxTreatment.map((group) => ({
			treatment: group.treatment,
			unrealizedGain: group.unrealizedGain,
			realizedGain: group.realizedGain,
			totalGain: group.totalGain,
			holdings: group.holdings.map((holding) => ({
				accountId: holding.accountId,
				securityId: holding.security.id,
				gain: holding.gain,
			})),
			sales: group.sales.map((sale) => ({
				id: sale.id,
				accountId: sale.accountId,
				securityId: sale.security.id,
				gain: sale.gain,
			})),
		})),
	).toEqual(
		fixtures
			.toSorted((a, b) => a.rank - b.rank)
			.map((fixture) => ({
				treatment: fixture.treatment,
				unrealizedGain: fixture.rank * 800,
				realizedGain: fixture.rank * 200,
				totalGain: fixture.rank * 1000,
				holdings: [
					{
						accountId: fixture.accountId,
						securityId: fixture.securityId,
						gain: fixture.rank * 800,
					},
					...(fixture.treatment === "tax_exempt"
						? [{ accountId: fixture.accountId, securityId: unknownId, gain: null }]
						: []),
				],
				sales: [
					{
						id: fixture.saleId,
						accountId: fixture.accountId,
						securityId: fixture.securityId,
						gain: fixture.rank * 200,
					},
					...(fixture.treatment === "tax_exempt"
						? [
								{
									id: unknownSale.id,
									accountId: fixture.accountId,
									securityId: unknownId,
									gain: null,
								},
							]
						: []),
				],
			})),
	);
});

it("counts labeled checking-account funding when an eligible investment account has no cash transactions", async () => {
	const checking = await account();
	await account({ type: "investment", subtype: "pea" });
	const contribution = await book(checking, "2026-11-01", -7500);
	const contributionRefund = await book(checking, "2026-11-02", 1200);
	const withdrawal = await book(checking, "2026-11-06", 2600);
	await updateTransaction(
		deps(),
		contribution,
		{ investmentActivityLabel: "Contribution" },
		{ origin: "user" },
	);
	await updateTransaction(
		deps(),
		contributionRefund,
		{ investmentActivityLabel: "Contribution" },
		{ origin: "user" },
	);
	await updateTransaction(
		deps(),
		withdrawal,
		{ investmentActivityLabel: "Withdrawal" },
		{ origin: "user" },
	);
	const report = await page();
	expect(report.investments).toMatchObject({
		available: true,
		activity: { contributions: 0, withdrawals: 0, trades: 0 },
	});
	expect(report.investmentFlows).toMatchObject({
		available: true,
		contributions: 6300,
		withdrawals: 2600,
		netFlow: 3700,
	});
});
