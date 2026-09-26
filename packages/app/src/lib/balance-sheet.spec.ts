import type { AccountListData, AccountSummaryData } from "@/hooks/useAccounts";

import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { balanceSheet } from "./balance-sheet";

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

	it("gives no segment when the group total is zero or less, and still lists the accounts", () => {
		const overdrawn = account("depository", -5_000);

		const [assets] = balanceSheet(listOf([overdrawn]));

		expect(assets?.total).toBe(-5_000);
		expect(assets?.types).toEqual([]);
		expect(assets?.accounts).toEqual([overdrawn]);
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
		expect(assets?.accounts).toContain(dollars);
	});

	it("lists an excluded account outside the shares, and leaves inactive ones out", () => {
		const excluded = account("vehicle", 8_000, { excludedFromReports: true });
		const inactive = account("property", 90_000, { active: false });

		const [assets] = balanceSheet(listOf([account("depository", 2_000), excluded, inactive]));

		expect(assets?.types).toEqual([{ type: "depository", amount: 2_000, share: 1 }]);
		expect(assets?.accounts).toContain(excluded);
		expect(assets?.accounts).not.toContain(inactive);
	});
});
