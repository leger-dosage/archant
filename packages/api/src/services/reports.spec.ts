import type { TempDatabase } from "../testing/temp-database.ts";
import type { NewAccountInput } from "./ledger/accounts.ts";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { createTempDatabase } from "../testing/temp-database.ts";
import { createAccount } from "./ledger/accounts.ts";
import { ingest } from "./ledger/ingest.ts";
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
	it("gives getNetWorth's figures, with the assets' and liabilities' series beside", async () => {
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
		const sheet = await getBalanceSheet(deps(), "1M");

		expect(sheet).toMatchObject({
			period: "1M",
			from: netWorth.from,
			to: "2026-09-21",
			currency: "EUR",
			netWorth: netWorth.netWorth,
			assets: 80_000,
			liabilities: 30_000,
			change: netWorth.change,
			leftOut: [],
		});
		expect(sheet.netWorth).toBe(50_000);
		expect(sheet.series.netWorth).toEqual({ interval: "day", points: netWorth.points });
		expect(sheet.series.assets.points.at(0)).toEqual({ date: "2026-09-01", balance: 100_000 });
		expect(sheet.series.assets.points.at(-1)).toEqual({ date: "2026-09-21", balance: 80_000 });
		// The card owes from its own opening, positive, as the dashboard counts it.
		expect(sheet.series.liabilities.points.at(0)).toEqual({ date: "2026-09-10", balance: 30_000 });
		expect(sheet.series.liabilities.points.at(-1)).toEqual({
			date: "2026-09-21",
			balance: 30_000,
		});
	});

	it("samples ten years monthly, every series at net worth's interval, its last point today's net worth", async () => {
		const checking = await account({ openingDate: "2016-09-21" });
		await spend(checking, "2021-03-04", -12_345);
		// Under two years: alone, it would be sampled by week.
		await account({
			name: "Carte",
			type: "credit_card",
			subtype: null,
			openingBalance: toMinorUnits(30_000),
			openingDate: "2025-03-01",
		});

		const sheet = await getBalanceSheet(deps(), "all");

		expect(sheet.series.netWorth.interval).toBe("month");
		expect(sheet.series.netWorth.points).toHaveLength(121);
		expect(sheet.series.netWorth.points.at(-1)).toEqual({
			date: "2026-09-21",
			balance: sheet.netWorth,
		});
		// Net worth's interval, so each point falls on one of its dates.
		expect(sheet.series.liabilities.interval).toBe("month");
		expect(sheet.series.liabilities.points).toHaveLength(19);
		expect(sheet.series.liabilities.points.at(0)).toEqual({ date: "2025-03-31", balance: 30_000 });
		expect(sheet.series.assets.interval).toBe("month");
		expect(sheet.series.assets.points.map((point) => point.date)).toEqual(
			sheet.series.netWorth.points.map((point) => point.date),
		);
	});

	it("leaves an account in another currency out of every total and names it", async () => {
		await account();
		const dollars = await account({ name: "Dollars", currency: "USD" });

		const sheet = await getBalanceSheet(deps(), "1M");

		expect(sheet).toMatchObject({ netWorth: 100_000, assets: 100_000 });
		expect(sheet.leftOut).toEqual([{ id: dollars, name: "Dollars", currency: "USD" }]);
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
});
