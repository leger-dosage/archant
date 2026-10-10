import type { TempDatabase } from "../testing/temp-database.ts";
import type { NewAccountInput } from "./ledger/accounts.ts";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toMicros } from "@archant/data/micros";
import { toMinorUnits } from "@archant/data/money";
import { categories } from "@archant/data/schema/categories";
import { securityPrices } from "@archant/data/schema/securities";

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
	getCashFlow,
	getCashFlowStatistics,
	getIncomeStatement,
	getNetWorth,
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

async function category(name: string) {
	const id = crypto.randomUUID();
	await temp.db.insert(categories).values({
		id,
		name,
		kind: "expense",
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

		const netWorth = await getNetWorth(deps(), "1M");
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
			change: netWorth.change,
			leftOut: [],
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
		expect(today.change).toBeNull();
		expect(today.netWorth).toBe(100_000);
		await expect(
			getBalanceSheet(deps(), { period: "last_5_years", interval: "1 day" }),
		).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "interval", code: "too_many_points" }],
		});
	});

	it("leaves an account in another currency out of every total and names it", async () => {
		await account();
		const dollars = await account({ name: "Dollars", currency: "USD" });

		const sheet = await getBalanceSheet(deps(), { period: "last_30_days", interval: "1 day" });

		expect(sheet).toMatchObject({ netWorth: 100_000, assets: 100_000 });
		expect(sheet.leftOut).toEqual([{ id: dollars, name: "Dollars", currency: "USD" }]);
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
				quantity: toMicros(10_000_000),
				price: toMicros(612_400_000),
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

		const netWorth = await getNetWorth(deps(), "1M");

		// 18 873,50 € of cash and 10 shares at 650 €.
		expect(netWorth.netWorth).toBe(1_887_350 + 650_000);
		expect(netWorth.points).toContainEqual({ date: "2026-09-10", balance: 1_887_350 + 612_400 });
	});
});

describe("getCashFlow", () => {
	it("names the accounts in another currency it leaves out", async () => {
		await account();
		const dollars = await account({ name: "Dollars", currency: "USD" });
		await spend(dollars, "2026-09-15", -8_000, "USD");

		const cashFlow = await getCashFlow(deps(), "2026-09");

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
			quantity: toMicros(1_000_000),
			price: toMicros(612_400_000),
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

		const cashFlow = await getCashFlow(deps(), "2026-09");

		expect(cashFlow.income).toBe(0);
		expect(cashFlow.expenses).toBe(-20_000);
		expect(cashFlow.lines).toEqual({
			income: [],
			expense: [
				{ categoryId: null, name: null, color: null, icon: null, amount: -20_000, share: 1 },
			],
		});
	});
});

describe("getCashFlow and one-time transactions", () => {
	it("leaves a one-time expense out of the month, where it counted 900 €", async () => {
		const checking = await account();
		const appliances = await category("Électroménager");
		const oneTime = await categorised(checking, "2026-09-10", -90_000, appliances);
		await updateTransaction(deps(), oneTime, { oneTime: true }, { origin: "user" });
		await spend(checking, "2026-09-11", -2_000);

		const cashFlow = await getCashFlow(deps(), "2026-09");

		expect(cashFlow.expenses).toBe(-2_000);
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
		const cashFlow = await getCashFlow(deps(), "2026-09");

		expect(statement).toMatchObject({ income: 3_000, expenses: -10_000 });
		expect(statement.breakdown?.lines.income.map((line) => line.categoryId)).toEqual([groceries]);
		expect(statement.breakdown?.lines.expense.map((line) => line.categoryId)).toEqual([groceries]);
		expect(cashFlow).toMatchObject({ income: 0, expenses: -7_000 });
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
