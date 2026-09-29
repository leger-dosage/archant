import type { AccountListData, AccountSummaryData } from "@/hooks/useAccounts";

import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { accountTypeGroups } from "./account-group-totals";

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

/** A list as `/accounts` answers it; the group totals play no part here. */
function listOf(
	assets: AccountSummaryData[],
	liabilities: AccountSummaryData[] = [],
): AccountListData {
	return {
		reportingCurrency: "EUR",
		groups: [
			{ classification: "asset", accounts: assets, total: toMinorUnits(0), excludedCount: 0 },
			{
				classification: "liability",
				accounts: liabilities,
				total: toMinorUnits(0),
				excludedCount: 0,
			},
		],
	};
}

describe("accountTypeGroups", () => {
	it("sums the active, reported accounts in the reporting currency", () => {
		const first = account("depository", 100_000);
		const second = account("depository", 25_050);
		const dollars = account("depository", 900_000, { currency: "USD" });
		const excluded = account("depository", 700_000, { excludedFromReports: true });

		const [group] = accountTypeGroups(listOf([first, second, dollars, excluded]), "all");

		expect(group?.type).toBe("depository");
		expect(group?.total).toBe(125_050);
		// The dollar account alone: the excluded one is left out by choice.
		expect(group?.excludedCount).toBe(1);
		// Listed all the same, as the column shows every active account.
		expect(group?.accounts).toEqual([first, second, dollars, excluded]);
	});

	it("leaves inactive accounts out of the list and the total", () => {
		const active = account("investment", 10_000);
		const inactive = account("investment", 50_000, { active: false });

		expect(accountTypeGroups(listOf([active, inactive]), "all")).toEqual([
			{
				type: "investment",
				classification: "asset",
				accounts: [active],
				total: 10_000,
				excludedCount: 0,
			},
		]);
	});

	it("drops a type whose accounts are all inactive", () => {
		const inactive = account("vehicle", 50_000, { active: false });

		expect(accountTypeGroups(listOf([inactive]), "all")).toEqual([]);
	});

	it("orders the types as ACCOUNT_TYPES does, assets before liabilities", () => {
		const list = listOf(
			[
				account("vehicle", 1),
				account("property", 1),
				account("investment", 1),
				account("depository", 1),
			],
			[account("loan", 1), account("credit_card", 1)],
		);

		expect(accountTypeGroups(list, "all").map((group) => group.type)).toEqual([
			"depository",
			"investment",
			"property",
			"vehicle",
			"credit_card",
			"loan",
		]);
	});

	it("keeps only the liability groups on the liabilities tab", () => {
		const list = listOf(
			[account("depository", 1)],
			[account("loan", 1), account("credit_card", 1)],
		);

		expect(accountTypeGroups(list, "liability").map((group) => group.type)).toEqual([
			"credit_card",
			"loan",
		]);
	});

	it("keeps only the asset groups on the assets tab", () => {
		const list = listOf([account("depository", 1)], [account("loan", 1)]);

		expect(accountTypeGroups(list, "asset").map((group) => group.type)).toEqual(["depository"]);
	});

	it("shows nothing on a tab with no account", () => {
		expect(accountTypeGroups(listOf([account("depository", 1)]), "liability")).toEqual([]);
		expect(accountTypeGroups(listOf([]), "all")).toEqual([]);
	});

	it("totals zero when no account of the type counts", () => {
		const dollars = account("credit_card", 30_000, { currency: "USD" });

		expect(accountTypeGroups(listOf([], [dollars]), "all")[0]).toMatchObject({
			total: 0,
			excludedCount: 1,
		});
	});

	it("counts no inactive account among those left out for their currency", () => {
		const inactive = account("loan", 30_000, { currency: "USD", active: false });
		const active = account("loan", 10_000);

		expect(accountTypeGroups(listOf([], [active, inactive]), "all")[0]?.excludedCount).toBe(0);
	});
});
