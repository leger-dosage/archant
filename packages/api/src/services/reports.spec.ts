import type { TempDatabase } from "../testing/temp-database.ts";
import type { NewAccountInput } from "./ledger/accounts.ts";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toMicros } from "@archant/data/micros";
import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { securityPrices } from "@archant/data/schema/securities";

import { insertSecurity } from "../testing/prices.ts";
import { createTempDatabase } from "../testing/temp-database.ts";
import { createAccount } from "./ledger/accounts.ts";
import { revalueHoldings } from "./ledger/holdings.ts";
import { ingest } from "./ledger/ingest.ts";
import { recordTrade } from "./ledger/trades.ts";
import { getBalanceSheet, getCashFlow, getNetWorth } from "./reports.ts";

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
	await ingest(
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
	it("counts a PEA's dividend and interest as uncategorised income, its buy nowhere, and an excluded account's not at all", async () => {
		const pea = await account({ name: "PEA", type: "investment", subtype: "pea" });
		const hidden = await account({ name: "PEA caché", type: "investment", subtype: "pea" });
		const lvmh = await insertSecurity(temp.db, {}, { held: false });
		const trade = async (accountId: string, input: Parameters<typeof recordTrade>[2]) =>
			recordTrade(deps(), accountId, input, { origin: "user" });
		const buy = {
			side: "buy",
			security: { source: "known", id: lvmh },
			date: "2026-09-10",
			quantity: toMicros(1_000_000),
			price: toMicros(612_400_000),
			fee: toMinorUnits(0),
		} as const;
		await trade(pea, buy);
		await trade(hidden, buy);
		await trade(pea, {
			side: "dividend",
			security: { source: "known", id: lvmh },
			date: "2026-09-15",
			amount: toMinorUnits(1234),
		});
		await trade(pea, {
			side: "interest",
			security: null,
			date: "2026-09-16",
			amount: toMinorUnits(300),
		});
		await trade(hidden, {
			side: "interest",
			security: null,
			date: "2026-09-16",
			amount: toMinorUnits(999),
		});
		await temp.db
			.update(accounts)
			.set({ excludedFromReports: true })
			.where(eq(accounts.id, hidden));

		const cashFlow = await getCashFlow(deps(), "2026-09");

		expect(cashFlow.income).toBe(1534);
		expect(cashFlow.expenses).toBe(0);
		expect(cashFlow.lines.income).toEqual([
			{ categoryId: null, name: null, color: null, icon: null, amount: 1534, share: 1 },
		]);
	});
});
