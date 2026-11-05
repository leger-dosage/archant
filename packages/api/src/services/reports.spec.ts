import type { TempDatabase } from "../testing/temp-database.ts";
import type { NewAccountInput } from "./ledger/accounts.ts";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActivityLabel } from "@archant/data/activity-labels";
import { toMicros } from "@archant/data/micros";
import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { categories } from "@archant/data/schema/categories";
import { securityPrices } from "@archant/data/schema/securities";

import { monthRange } from "../domain/dates.ts";
import { quantity as qty, tradePrice } from "../testing/decimals.ts";
import { insertSecurity } from "../testing/prices.ts";
import { createTempDatabase } from "../testing/temp-database.ts";
import { createAccount } from "./ledger/accounts.ts";
import { updateTransaction } from "./ledger/edits.ts";
import { revalueHoldings } from "./ledger/holdings.ts";
import { ingest } from "./ledger/ingest.ts";
import { findTransaction } from "./ledger/queries.ts";
import { recordTrade } from "./ledger/trades.ts";
import { matchTransfer } from "./ledger/transfers.ts";
import {
	getBalanceSheet,
	getCashFlowStatistics,
	getDashboardCashFlow,
	getIncomeStatement,
	getInvestmentSummary,
	getMoneyFlow,
	getNetWorth,
	getSpendingTrend,
} from "./reports.ts";

let temp: TempDatabase;
const deps = () => ({ db: temp.db, timeZone: "Europe/Paris" });

beforeEach(async () => {
	temp = await createTempDatabase();
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-09-21T10:00:00Z"));
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

async function spend(accountId: string, date: string, amount: number, currency = "EUR") {
	const { created } = await ingest(
		deps(),
		accountId,
		{
			transactions: [
				{
					externalId: null,
					date,
					amount: toMinorUnits(amount),
					currency,
					label: "CB",
					reference: null,
					notes: null,
					pending: false,
				},
			],
			balance: null,
			rejected: [],
		},
		{ manual: true },
		{ origin: "user" },
	);

	return created[0] ?? "";
}

/** The dashboard's cash flow over a calendar month, as a custom range. */
const monthCashFlow = async (month: string) =>
	getDashboardCashFlow(deps(), {
		period: "last_30_days",
		startDate: `${month}-01`,
		endDate: monthRange(month).to,
	});

async function category(name: string) {
	const id = crypto.randomUUID();
	await temp.db.insert(categories).values({
		id,
		name,
		color: "#e99537",
		icon: "tag",
		parentId: null,
		createdAt: 0,
		updatedAt: 0,
	});

	return id;
}

async function categorised(accountId: string, date: string, amount: number, categoryId: string) {
	const id = await spend(accountId, date, amount);
	await updateTransaction(deps(), id, { categoryId }, { origin: "user" });

	return id;
}

describe("getBalanceSheet", () => {
	it("gives getNetWorth's figures today and its daily balances on each of Sure's dates", async () => {
		const checking = await account();
		await account({
			name: "Carte",
			type: "credit_card",
			subtype: null,
			openingBalance: toMinorUnits(30_000),
			openingDate: "2026-09-10",
		});
		await spend(checking, "2026-09-15", -20_000);

		const netWorth = await getNetWorth(deps(), { period: "last_30_days" });
		const sheet = await getBalanceSheet(deps(), {
			from: "2026-08-25",
			to: "2026-09-21",
			interval: "1 week",
		});

		expect(sheet).toMatchObject({
			asOf: "2026-09-21",
			oldestEntryDate: "2026-09-01",
			currency: "EUR",
			netWorth: netWorth.netWorth,
			assets: 80_000,
			liabilities: 30_000,
			range: { from: "2026-08-25", to: "2026-09-21" },
			interval: "1 week",
		});
		// 25 August, before any opening, then 1, 8 and 15 September, then today.
		expect(sheet.series).toEqual({
			netWorth: [0, 100_000, 100_000, 50_000, 50_000],
			assets: [0, 100_000, 100_000, 80_000, 80_000],
			// The card owes from its own opening, positive, as the dashboard counts it.
			liabilities: [0, 0, 0, 30_000, 30_000],
		});
	});

	it("samples ten years monthly, its last value today's net worth", async () => {
		const checking = await account({ openingDate: "2016-09-21" });
		await spend(checking, "2021-03-04", -12_345);

		const sheet = await getBalanceSheet(deps(), { period: "last_10_years", interval: "1 month" });

		expect(sheet.range).toEqual({ from: "2016-09-21", to: "2026-09-21" });
		expect(sheet.series.netWorth).toHaveLength(121);
		expect(sheet.series.netWorth.at(0)).toBe(100_000);
		expect(sheet.series.netWorth.at(-1)).toBe(sheet.netWorth);
	});

	it("answers no series for a range starting today, and refuses more than 400 points", async () => {
		await account();

		const today = await getBalanceSheet(deps(), { period: "current_week", interval: "1 day" });

		expect(today.series).toEqual({ netWorth: [], assets: [], liabilities: [] });
		expect(today.netWorth).toBe(100_000);
		await expect(
			getBalanceSheet(deps(), { period: "last_5_years", interval: "1 day" }),
		).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "interval", code: "too_many_points" }],
		});
	});

	it("leaves an account in another currency out of every total", async () => {
		await account();
		await account({ name: "Dollars", currency: "USD" });

		const sheet = await getBalanceSheet(deps(), { period: "last_30_days", interval: "1 day" });

		expect(sheet).toMatchObject({ netWorth: 100_000, assets: 100_000 });
		expect(sheet.series.netWorth.at(-1)).toBe(100_000);
	});
});

describe("getNetWorth", () => {
	it("counts a PEA's holding at the provider's price that rose since the buy", async () => {
		const pea = await account({
			name: "PEA",
			type: "investment",
			subtype: "pea",
			openingBalance: toMinorUnits(2_500_000),
		});
		const lvmh = await insertSecurity(temp.db, {}, { held: false });
		await recordTrade(
			deps(),
			pea,
			{
				side: "buy",
				security: { source: "known", id: lvmh },
				date: "2026-09-10",
				quantity: qty("10"),
				price: tradePrice("612.4"),
				fee: toMinorUnits(250),
			},
			{ origin: "user" },
		);
		await temp.db.transaction(
			async (tx) => {
				await tx.insert(securityPrices).values({
					securityId: lvmh,
					date: "2026-09-11",
					price: toMicros(650_000_000),
					currency: "EUR",
					source: "provider",
				});
				await revalueHoldings(tx, lvmh, "2026-09-11", "Europe/Paris", { origin: "provider" });
			},
			{ behavior: "immediate" },
		);

		const netWorth = await getNetWorth(deps(), { period: "last_30_days" });

		// 18 873,50 € of cash and 10 shares at 650 €.
		expect(netWorth.netWorth).toBe(1_887_350 + 650_000);
		expect(netWorth.points).toContainEqual({ date: "2026-09-10", balance: 1_887_350 + 612_400 });
	});

	it("adds an other asset and subtracts an other liability, which a transaction moves neither of", async () => {
		const jewellery = await account({
			name: "Bijoux",
			type: "other_asset",
			subtype: null,
			openingBalance: toMinorUnits(500_000),
		});
		const relative = await account({
			name: "Prêt de Marie",
			type: "other_liability",
			subtype: null,
			openingBalance: toMinorUnits(200_000),
		});
		await spend(jewellery, "2026-09-10", 30_000);
		await spend(relative, "2026-09-10", 50_000);

		const netWorth = await getNetWorth(deps(), { period: "last_30_days" });

		expect(netWorth).toMatchObject({ assets: 500_000, liabilities: 200_000, netWorth: 300_000 });
	});
});

describe("getDashboardCashFlow", () => {
	it("names the accounts in another currency it leaves out", async () => {
		await account();
		const dollars = await account({ name: "Dollars", currency: "USD" });
		await spend(dollars, "2026-09-15", -8_000, "USD");

		const cashFlow = await monthCashFlow("2026-09");

		expect(cashFlow.expenses).toBe(0);
		expect(cashFlow.leftOut).toEqual([{ id: dollars, name: "Dollars", currency: "USD" }]);
	});
	it("counts nothing of a PEA, its cash line, dividend and interest included, where they made 15,34 € of income, and still a contribution into it as an expense", async () => {
		const checking = await account();
		const pea = await account({ name: "PEA", type: "investment", subtype: "pea" });
		const lvmh = await insertSecurity(temp.db, {}, { held: false });
		const trade = async (input: Parameters<typeof recordTrade>[2]) =>
			recordTrade(deps(), pea, input, { origin: "user" });
		await trade({
			side: "buy",
			security: { source: "known", id: lvmh },
			date: "2026-09-10",
			quantity: qty("1"),
			price: tradePrice("612.4"),
			fee: toMinorUnits(0),
		});
		await trade({
			side: "dividend",
			security: { source: "known", id: lvmh },
			date: "2026-09-15",
			amount: toMinorUnits(1234),
		});
		await trade({
			side: "interest",
			security: null,
			date: "2026-09-16",
			amount: toMinorUnits(300),
		});
		await spend(pea, "2026-09-17", -1_500);
		const outflow = await spend(checking, "2026-09-18", -20_000);
		const inflow = await spend(pea, "2026-09-18", 20_000);
		// The matcher may have proposed the pair already.
		if ((await findTransaction(deps(), outflow))?.transfer === null) {
			await matchTransfer(deps(), outflow, inflow, { origin: "user" });
		}

		const contributions = (await findTransaction(deps(), outflow))?.categoryId ?? null;

		const cashFlow = await monthCashFlow("2026-09");

		expect(cashFlow.income).toBe(0);
		expect(cashFlow.expenses).toBe(-20_000);
		expect(cashFlow.lines).toEqual({
			income: [],
			expense: [
				{
					categoryId: contributions,
					name: "Contributions aux investissements",
					color: "#0d9488",
					icon: "trending-up",
					amount: -20_000,
					share: 1,
				},
			],
		});
	});
});

describe("getDashboardCashFlow and Sure's tax treatment", () => {
	it("leaves a retirement account's expense out, counts a gold account's and a blank investment's, and keeps all three in net worth", async () => {
		const retirement = await account({
			name: "Retraite",
			type: "investment",
			subtype: "retirement",
		});
		const gold = await account({ name: "Or", type: "investment", subtype: "gold" });
		const blank = await account({ name: "Placement", type: "investment", subtype: null });
		await spend(retirement, "2026-09-15", -4_000);
		await spend(gold, "2026-09-15", -2_000);
		await spend(blank, "2026-09-15", -1_000);

		const cashFlow = await monthCashFlow("2026-09");
		const netWorth = await getNetWorth(deps(), { period: "last_30_days" });

		expect(cashFlow.expenses).toBe(-3_000);
		expect(netWorth.netWorth).toBe(3 * 100_000 - 7_000);
	});
});

describe("getDashboardCashFlow and a crypto account's tax treatment", () => {
	it("leaves a tax-exempt crypto account's 100 € of income out, counts a taxable one's, and keeps both in net worth", async () => {
		const exempt = await account({
			name: "Crypto exonérée",
			type: "crypto",
			subtype: "exchange",
			details: { taxTreatment: "tax_exempt" },
		});
		const taxable = await account({
			name: "Crypto imposable",
			type: "crypto",
			subtype: "wallet",
			details: { taxTreatment: "taxable" },
		});
		await spend(exempt, "2026-09-15", 10_000);
		await spend(taxable, "2026-09-15", 2_000);

		const cashFlow = await monthCashFlow("2026-09");
		const netWorth = await getNetWorth(deps(), { period: "last_30_days" });

		expect(cashFlow.income).toBe(2_000);
		expect(netWorth.netWorth).toBe(2 * 100_000 + 12_000);
	});
});

describe("getDashboardCashFlow and one-time transactions", () => {
	it("leaves a one-time expense out of the month, where it counted 900 €", async () => {
		const checking = await account();
		const appliances = await category("Électroménager");
		const oneTime = await categorised(checking, "2026-09-10", -90_000, appliances);
		await updateTransaction(deps(), oneTime, { oneTime: true }, { origin: "user" });
		await spend(checking, "2026-09-11", -2_000);

		const cashFlow = await monthCashFlow("2026-09");

		expect(cashFlow.expenses).toBe(-2_000);
	});
});

describe("getDashboardCashFlow and an investment account's activity labels", () => {
	// A brokerage account: a PEA is tax-advantaged, so none of its lines count.
	it("leaves a sweep in, a sweep out, a transfer and an exchange out of the month, counts a dividend, and keeps them all in net worth", async () => {
		const brokerage = await account({ name: "CTO", type: "investment", subtype: "brokerage" });
		const labelled = async (amount: number, investmentActivityLabel: ActivityLabel) => {
			const id = await spend(brokerage, "2026-09-10", amount);
			await updateTransaction(deps(), id, { investmentActivityLabel }, { origin: "user" });
		};
		await labelled(50_000, "Sweep In");
		await labelled(-50_000, "Sweep Out");
		await labelled(-20_000, "Transfer");
		await labelled(30_000, "Exchange");
		await labelled(1_200, "Dividend");

		const cashFlow = await monthCashFlow("2026-09");
		const netWorth = await getNetWorth(deps(), { period: "last_30_days" });

		expect(cashFlow.income).toBe(1_200);
		expect(cashFlow.expenses).toBe(0);
		expect(netWorth.netWorth).toBe(100_000 + 50_000 - 50_000 - 20_000 + 30_000 + 1_200);
	});
});

describe("getDashboardCashFlow over the dashboard's period", () => {
	it("starts `all_time` at the oldest entry and weighs the donut's lines to the net expense total", async () => {
		const checking = await account({ openingDate: "2026-03-14" });
		const groceries = await category("Courses");
		const rent = await category("Loyer");
		await categorised(checking, "2026-04-10", -30_000, groceries);
		await categorised(checking, "2026-09-02", -50_000, rent);
		await categorised(checking, "2026-09-03", 5_000, groceries);
		await spend(checking, "2026-09-04", -7_000);

		const cashFlow = await getDashboardCashFlow(deps(), { period: "all_time" });

		expect(cashFlow).toMatchObject({
			period: "all_time",
			from: "2026-03-14",
			to: "2026-09-21",
			expenses: -82_000,
		});
		const shares = cashFlow.lines.expense.map((line) => line.share ?? 0);
		expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 12);
		expect(cashFlow.lines.expense.map((line) => line.amount)).toEqual([-50_000, -25_000, -7_000]);
		expect(cashFlow.sankey.nodes.map((node) => node.id)).toEqual([
			"cash_flow_node",
			`expense_${rent}`,
			`expense_${groceries}`,
			"expense_uncategorised",
		]);
	});

	it("reads a custom range as given, its key `null`", async () => {
		const checking = await account();
		await spend(checking, "2026-09-09", -1_000);
		await spend(checking, "2026-09-10", -2_000);

		const cashFlow = await getDashboardCashFlow(deps(), {
			period: "last_30_days",
			startDate: "2026-09-10",
			endDate: "2026-09-12",
		});

		expect(cashFlow).toMatchObject({ period: null, from: "2026-09-10", expenses: -2_000 });
	});
});

describe("getMoneyFlow", () => {
	it("leaves a PEA out of the accounts it offers and totals", async () => {
		const checking = await account();
		const pea = await account({ name: "PEA", type: "investment", subtype: "pea" });
		await spend(checking, "2026-09-10", -1_000);
		await spend(pea, "2026-09-10", -4_000);

		const flow = await getMoneyFlow(deps(), { accountIds: [pea] });

		expect(flow).toMatchObject({
			month: "2026-09",
			accountIds: null,
			accounts: [{ id: checking, name: "Courant" }],
			expenses: -1_000,
		});
	});
});

describe("getSpendingTrend", () => {
	it("climbs day by day on the expense side alone, so a refund never lowers it", async () => {
		const checking = await account({ openingDate: "2026-08-01" });
		await spend(checking, "2026-09-01", -1_000);
		await spend(checking, "2026-09-03", 5_000);
		await spend(checking, "2026-09-03", -500);

		const trend = await getSpendingTrend(deps(), undefined);

		expect(trend.current.slice(0, 4).map((point) => point.amount)).toEqual([
			-1_000, -1_000, -1_500, -1_500,
		]);
		expect(trend.currentTotal).toBe(-1_500);
	});

	it("folds nothing of a shorter previous month, and stops the comparison at this month's day", async () => {
		vi.setSystemTime(new Date("2026-03-04T10:00:00Z"));
		const checking = await account({ openingDate: "2026-02-01" });
		await spend(checking, "2026-02-03", -1_000);
		await spend(checking, "2026-02-27", -2_000);

		const trend = await getSpendingTrend(deps(), "2026-03");

		expect(trend).toMatchObject({
			days: 31,
			currentTotal: 0,
			previousTotal: -1_000,
			previousComparisonDay: 4,
		});
		expect(trend.current).toHaveLength(4);
		expect(trend.previous).toHaveLength(28);
		expect(trend.previous.at(-1)).toMatchObject({ day: 28, amount: -3_000 });
	});
});

describe("getCashFlowStatistics", () => {
	it("reads the whole history, this month and next included, and each category's own rows", async () => {
		const checking = await account({ openingDate: "2026-06-01" });
		const groceries = await category("Courses");
		await categorised(checking, "2026-07-10", -10_000, groceries);
		await categorised(checking, "2026-09-10", -20_000, groceries);
		await categorised(checking, "2026-10-02", -60_000, groceries);
		await spend(checking, "2026-08-05", 250_000);

		const { family, categories: byCategory } = await getCashFlowStatistics(deps());

		expect(family).toEqual({
			income: { median: 250_000, average: 250_000 },
			expense: { median: 20_000, average: 30_000 },
		});
		expect(byCategory.get(groceries)?.expense.median).toBe(20_000);
		expect(byCategory.get(null)?.income.median).toBe(250_000);
	});
});

describe("getIncomeStatement", () => {
	it("gives Sure's monthly statistics without an account filter, the next month included, and none with one", async () => {
		const checking = await account({ openingDate: "2026-06-01" });
		const savings = await account({
			name: "Livret",
			subtype: "savings",
			openingDate: "2026-06-01",
		});
		await spend(checking, "2026-07-10", -10_000);
		await spend(checking, "2026-08-10", -30_000);
		await spend(checking, "2026-10-02", -60_000);
		await spend(savings, "2026-08-31", 1_200);
		await spend(savings, "2026-09-30", 1_400);

		const query = { from: "2026-09-01", to: "2026-09-30", byMonth: false, comparePrevious: false };
		const all = await getIncomeStatement(deps(), query);
		const scoped = await getIncomeStatement(deps(), { ...query, accountIds: [savings] });

		expect(all.breakdown).toMatchObject({
			medianMonthlyIncome: 1_300,
			medianMonthlyExpenses: -30_000,
			avgMonthlyExpenses: -33_333,
		});
		expect(scoped).toMatchObject({ income: 1_400, breakdown: null });
	});

	it("keeps a refund as income in its category, where the net dashboard lowers the expense", async () => {
		const checking = await account();
		const groceries = await category("Courses");
		await categorised(checking, "2026-09-10", -10_000, groceries);
		await categorised(checking, "2026-09-12", 3_000, groceries);

		const statement = await getIncomeStatement(deps(), {
			from: "2026-09-01",
			to: "2026-09-30",
			byMonth: false,
			comparePrevious: false,
		});
		const cashFlow = await monthCashFlow("2026-09");

		expect(statement).toMatchObject({ income: 3_000, expenses: -10_000 });
		expect(statement.breakdown?.lines.income.map((line) => line.categoryId)).toEqual([groceries]);
		expect(statement.breakdown?.lines.expense.map((line) => line.categoryId)).toEqual([groceries]);
		// Every category, so a tool lists those without a counted row at zero.
		expect(statement.breakdown?.categories.map((row) => row.id)).toContain(groceries);
		expect(cashFlow).toMatchObject({ income: 0, expenses: -7_000 });
	});

	it("refuses a riester among the accounts asked, as a PEA", async () => {
		const checking = await account();
		const riester = await account({ name: "Riester", type: "investment", subtype: "riester" });

		await expect(
			getIncomeStatement(deps(), {
				from: "2026-09-01",
				to: "2026-09-30",
				accountIds: [checking, riester],
				byMonth: false,
				comparePrevious: false,
			}),
		).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "accountIds.1", code: "unknown_account" }],
		});
	});

	it("refuses a PEA among the accounts asked, as it would report it as zero", async () => {
		const checking = await account();
		const pea = await account({ name: "PEA", type: "investment", subtype: "pea" });

		await expect(
			getIncomeStatement(deps(), {
				from: "2026-09-01",
				to: "2026-09-30",
				accountIds: [checking, pea],
				byMonth: false,
				comparePrevious: false,
			}),
		).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "accountIds.1", code: "unknown_account" }],
		});
	});
});

/** September 2026 as a custom range. */
const september = {
	period: "last_30_days",
	startDate: "2026-09-01",
	endDate: "2026-09-30",
} as const;
const summaryOf = async (query: Parameters<typeof getInvestmentSummary>[1] = september) =>
	getInvestmentSummary(deps(), query);
const investmentAccount = async (overrides: Partial<NewAccountInput> = {}) =>
	account({
		name: "PEA",
		type: "investment",
		subtype: "pea",
		openingDate: "2026-08-01",
		...overrides,
	});
const tradeOn = async (accountId: string, input: Parameters<typeof recordTrade>[2]) =>
	recordTrade(deps(), accountId, input, { origin: "user" });
const buy = async (
	accountId: string,
	securityId: string,
	date: string,
	units: string,
	price: string,
) =>
	tradeOn(accountId, {
		side: "buy",
		security: { source: "known", id: securityId },
		date,
		quantity: qty(units),
		price: tradePrice(price),
		fee: toMinorUnits(0),
	});

describe("getInvestmentSummary", () => {
	it("is unavailable without an investment account, an inactive or excluded PEA counting as none", async () => {
		await account();
		const inactive = await investmentAccount();
		const excluded = await investmentAccount({ name: "PEA exclu" });
		await temp.db.update(accounts).set({ active: false }).where(eq(accounts.id, inactive));
		await temp.db
			.update(accounts)
			.set({ excludedFromReports: true })
			.where(eq(accounts.id, excluded));

		await expect(summaryOf()).resolves.toEqual({ available: false });
	});

	it("gives a PEA that never traded its value alone: no return, no holding, no activity", async () => {
		await investmentAccount({ openingBalance: toMinorUnits(250_000) });

		await expect(summaryOf()).resolves.toEqual({
			available: true,
			period: null,
			from: "2026-09-01",
			to: "2026-09-30",
			currency: "EUR",
			value: 250_000,
			totalReturn: null,
			holdings: [],
			activity: { contributions: 0, withdrawals: 0, trades: 0 },
			leftOut: [],
		});
	});

	it("totals the period's buys, fee included, its sales and every trade row, a dividend's too, and neither a cash deposit nor a trade before it", async () => {
		const peaId = await investmentAccount({ openingBalance: toMinorUnits(500_000) });
		const lvmh = await insertSecurity(temp.db, {}, { held: false });
		await buy(peaId, lvmh, "2026-08-20", "1", "50");
		await tradeOn(peaId, {
			side: "buy",
			security: { source: "known", id: lvmh },
			date: "2026-09-10",
			quantity: qty("10"),
			price: tradePrice("100"),
			fee: toMinorUnits(500),
		});
		await tradeOn(peaId, {
			side: "sell",
			security: { source: "known", id: lvmh },
			date: "2026-09-12",
			quantity: qty("4"),
			price: tradePrice("100"),
			fee: toMinorUnits(0),
		});
		await tradeOn(peaId, {
			side: "dividend",
			security: { source: "known", id: lvmh },
			date: "2026-09-15",
			amount: toMinorUnits(1_200),
		});
		await spend(peaId, "2026-09-16", 200_000);

		const summary = await summaryOf();

		expect(summary).toMatchObject({
			activity: { contributions: 100_500, withdrawals: 40_000, trades: 3 },
		});
	});

	it("rolls one security held in two PEAs into one row of 5 000 €, weighed over the portfolio, cash included", async () => {
		const first = await investmentAccount({ openingBalance: toMinorUnits(300_000) });
		const second = await investmentAccount({
			name: "PEA-PME",
			openingBalance: toMinorUnits(700_000),
		});
		const cw8 = await insertSecurity(
			temp.db,
			{ ticker: "CW8", isin: "LU1681043599", name: "Amundi MSCI World" },
			{ held: false },
		);
		const lvmh = await insertSecurity(temp.db, {}, { held: false });
		await buy(first, cw8, "2026-09-10", "30", "100");
		await buy(second, cw8, "2026-09-10", "20", "100");
		await buy(second, lvmh, "2026-09-11", "1", "600");

		const summary = await summaryOf({ period: "last_30_days" });

		// 10 000 € of cash and holdings, 5 600 € of them invested.
		expect(summary).toMatchObject({
			available: true,
			period: "last_30_days",
			value: 1_000_000,
			totalReturn: { gain: 0, percent: "0", trend: "flat" },
			holdings: [
				{
					security: { id: cw8, name: "Amundi MSCI World", ticker: "CW8" },
					amount: 500_000,
					weight: "50",
					returnPercent: "0",
					returnTrend: "flat",
				},
				{
					security: { id: lvmh, ticker: "MC.PA" },
					amount: 60_000,
					weight: "6",
					returnPercent: "0",
					returnTrend: "flat",
				},
			],
			activity: { contributions: 560_000, withdrawals: 0, trades: 3 },
		});
	});

	it("measures the total return of every holding against its book value, as the price moved", async () => {
		const peaId = await investmentAccount({ openingBalance: toMinorUnits(100_000) });
		const lvmh = await insertSecurity(temp.db, {}, { held: false });
		await buy(peaId, lvmh, "2026-09-10", "10", "50");
		await temp.db.transaction(
			async (tx) => {
				await tx.insert(securityPrices).values({
					securityId: lvmh,
					date: "2026-09-11",
					price: toMicros(45_000_000),
					currency: "EUR",
					source: "provider",
				});
				await revalueHoldings(tx, lvmh, "2026-09-11", "Europe/Paris", { origin: "provider" });
			},
			{ behavior: "immediate" },
		);

		const summary = await summaryOf();

		// 450 € for 500 €: −50 €, −10 %; the cash of 500 € still counts in the value.
		expect(summary).toMatchObject({
			value: 95_000,
			totalReturn: { gain: -5_000, percent: "-10", trend: "down" },
			holdings: [
				{ amount: 45_000, weight: "47.368421", returnPercent: "-10", returnTrend: "down" },
			],
		});
	});

	it("gives a free share's return as infinite, Sure's « ＋∞ », once it is priced", async () => {
		const peaId = await investmentAccount({ openingBalance: toMinorUnits(0) });
		const lvmh = await insertSecurity(temp.db, {}, { held: false });
		await buy(peaId, lvmh, "2026-09-10", "2", "0");
		await temp.db.transaction(
			async (tx) => {
				await tx.insert(securityPrices).values({
					securityId: lvmh,
					date: "2026-09-11",
					price: toMicros(30_000_000),
					currency: "EUR",
					source: "provider",
				});
				await revalueHoldings(tx, lvmh, "2026-09-11", "Europe/Paris", { origin: "provider" });
			},
			{ behavior: "immediate" },
		);

		await expect(summaryOf()).resolves.toMatchObject({
			totalReturn: { gain: 6_000, percent: "Infinity", trend: "up" },
			holdings: [{ amount: 6_000, returnPercent: "Infinity", returnTrend: "up" }],
		});
	});

	it("leaves a brokerage account in dollars out of every figure and names it", async () => {
		await investmentAccount({ openingBalance: toMinorUnits(100_000) });
		const dollars = await investmentAccount({
			name: "Courtage US",
			subtype: "brokerage",
			currency: "USD",
			openingBalance: toMinorUnits(900_000),
		});
		await account({ name: "Dollars", currency: "USD" });

		const summary = await summaryOf();

		expect(summary).toMatchObject({
			value: 100_000,
			leftOut: [{ id: dollars, name: "Courtage US", currency: "USD" }],
		});
	});

	it("is available with a dollar account alone, to name it", async () => {
		const dollars = await investmentAccount({
			name: "Courtage US",
			subtype: "brokerage",
			currency: "USD",
		});

		await expect(summaryOf()).resolves.toMatchObject({
			available: true,
			value: 0,
			leftOut: [{ id: dollars }],
		});
	});
});
