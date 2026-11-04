import type { AccountListData, AccountSummaryData } from "@/hooks/useAccounts";

import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { balanceSheet, litBars } from "./balance-sheet";

let nextId = 0;

const account = (
	type: AccountSummaryData["type"],
	balance: number,
	overrides: Partial<AccountSummaryData> = {},
): AccountSummaryData => {
	nextId += 1;

	return {
		id: `account-${nextId}`,
		name: `Compte ${nextId}`,
		type,
		subtype: null,
		currency: "EUR",
		balance: toMinorUnits(balance),
		active: true,
		excludedFromReports: false,
		linked: false,
		institutionName: null,
		...overrides,
	};
};

/** A group's total as the API sums it: active, included, in euros. */
const totalOf = (accounts: AccountSummaryData[]) =>
	toMinorUnits(
		accounts
			.filter((item) => item.active && !item.excludedFromReports && item.currency === "EUR")
			.reduce((sum, item) => sum + item.balance, 0),
	);

/** A list as `/accounts` answers it. */
function listOf(assets: AccountSummaryData[], liabilities: AccountSummaryData[] = []) {
	return {
		reportingCurrency: "EUR",
		defaultAccountId: null,
		groups: [
			{ classification: "asset", accounts: assets, total: totalOf(assets), excludedCount: 0 },
			{
				classification: "liability",
				accounts: liabilities,
				total: totalOf(liabilities),
				excludedCount: 0,
			},
		],
	} satisfies AccountListData;
}

describe("balanceSheet", () => {
	it("splits each group by type in a fixed order, shares over the group total", () => {
		const [assets, liabilities] = balanceSheet(
			listOf(
				[account("property", 75_000), account("depository", 15_000), account("depository", 10_000)],
				[account("loan", 30_000), account("credit_card", 10_000)],
			),
		);

		expect(assets?.total).toBe(100_000);
		expect(assets?.types).toEqual([
			{ type: "depository", amount: 25_000, share: 0.25 },
			{ type: "property", amount: 75_000, share: 0.75 },
		]);
		expect(liabilities?.types).toEqual([
			{ type: "credit_card", amount: 10_000, share: 0.25 },
			{ type: "loan", amount: 30_000, share: 0.75 },
		]);
	});

	it("puts an other asset after the vehicles and an other liability after the loans", () => {
		const [assets, liabilities] = balanceSheet(
			listOf(
				[account("other_asset", 5_000), account("vehicle", 5_000)],
				[account("other_liability", 2_000), account("loan", 2_000)],
			),
		);

		expect(assets?.types.map((entry) => entry.type)).toEqual(["vehicle", "other_asset"]);
		expect(liabilities?.types.map((entry) => entry.type)).toEqual(["loan", "other_liability"]);
	});

	it("gives no segment when the group total is zero or less, and still lists the accounts", () => {
		const overdrawn = account("depository", -5_000);

		const [assets] = balanceSheet(listOf([overdrawn]));

		expect(assets?.total).toBe(-5_000);
		expect(assets?.types).toEqual([]);
		expect(assets?.rows).toEqual([
			{
				type: "depository",
				total: -5_000,
				weight: 100,
				accounts: [{ account: overdrawn, weight: 100 }],
			},
		]);
	});

	it("gives no segment to a type whose sum is zero or less", () => {
		const [assets] = balanceSheet(
			listOf([account("depository", -2_000), account("investment", 12_000)]),
		);

		expect(assets?.types).toEqual([{ type: "investment", amount: 12_000, share: 1.2 }]);
	});

	it("lists a foreign-currency account outside the shares", () => {
		const dollars = account("investment", 50_000, { currency: "USD" });

		const [assets] = balanceSheet(listOf([account("depository", 10_000), dollars]));

		expect(assets?.types).toEqual([{ type: "depository", amount: 10_000, share: 1 }]);
		expect(assets?.rows.find((row) => row.type === "investment")).toEqual({
			type: "investment",
			total: 0,
			weight: 0,
			accounts: [{ account: dollars, weight: null }],
		});
	});

	it("lists an excluded account outside the shares, and leaves inactive ones out", () => {
		const excluded = account("vehicle", 8_000, { excludedFromReports: true });
		const inactive = account("property", 90_000, { active: false });

		const [assets] = balanceSheet(listOf([account("depository", 2_000), excluded, inactive]));

		expect(assets?.types).toEqual([{ type: "depository", amount: 2_000, share: 1 }]);
		expect(assets?.rows.map((row) => row.type)).toEqual(["depository", "vehicle"]);
		expect(assets?.rows[1]?.accounts).toEqual([{ account: excluded, weight: 400 }]);
	});

	it("gives one row per type in Sure's order, its counted sum and weight over the side's total", () => {
		const joint = account("depository", 15_000);
		const savings = account("depository", 10_000);
		const house = account("property", 75_000);

		const [assets] = balanceSheet(listOf([house, joint, savings]));

		expect(assets?.rows).toEqual([
			{
				type: "depository",
				total: 25_000,
				weight: 25,
				accounts: [
					{ account: joint, weight: 15 },
					{ account: savings, weight: 10 },
				],
			},
			{ type: "property", total: 75_000, weight: 75, accounts: [{ account: house, weight: 75 }] },
		]);
		expect(assets?.rows.reduce((sum, row) => sum + row.weight, 0)).toBe(100);
	});

	it("weighs an excluded account over the side's total, and leaves it out of its type's", () => {
		const car = account("vehicle", 8_000, { excludedFromReports: true });

		const [assets] = balanceSheet(listOf([account("depository", 10_000), car]));

		expect(assets?.total).toBe(10_000);
		expect(assets?.rows[1]).toEqual({
			type: "vehicle",
			total: 0,
			weight: 0,
			accounts: [{ account: car, weight: 80 }],
		});
	});

	it("weighs every row and account 0 when the side's total is 0", () => {
		const empty = account("depository", 0);

		const [assets] = balanceSheet(listOf([empty]));

		expect(assets?.rows).toEqual([
			{ type: "depository", total: 0, weight: 0, accounts: [{ account: empty, weight: 0 }] },
		]);
	});

	it("gives an empty side no row", () => {
		const [, liabilities] = balanceSheet(listOf([account("depository", 1_000)]));

		expect(liabilities?.rows).toEqual([]);
	});

	it("keeps an exact share exact, so 60 % lights three bars", () => {
		const [assets] = balanceSheet(listOf([account("depository", 3), account("property", 2)]));

		expect(assets?.rows[0]?.weight).toBe(60);
	});
});

describe("litBars", () => {
	it("lights one of Sure's five bars per 20 % begun", () => {
		expect(litBars(0)).toBe(0);
		expect(litBars(20)).toBe(1);
		expect(litBars(21)).toBe(2);
		expect(litBars(25)).toBe(2);
		expect(litBars(100)).toBe(5);
	});

	it("lights none under 0 and no more than five over 100", () => {
		expect(litBars(-30)).toBe(0);
		expect(litBars(400)).toBe(5);
	});
});
