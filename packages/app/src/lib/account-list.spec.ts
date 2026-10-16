import type { AccountListData, AccountSummaryData } from "@/hooks/useAccounts";

import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { accountsByName } from "./account-list";

const account = (
	name: string,
	type: AccountSummaryData["type"],
	balance: number,
): AccountSummaryData => ({
	id: name,
	name,
	type,
	subtype: null,
	currency: "EUR",
	balance: toMinorUnits(balance),
	active: true,
	excludedFromReports: false,
	linked: false,
});

describe("accountsByName", () => {
	it("lists assets then liabilities, each by name, whatever the order the API sorted them in", () => {
		const list = {
			reportingCurrency: "EUR",
			defaultAccountId: null,
			groups: [
				{
					classification: "asset",
					accounts: [
						account("Livret A", "depository", 840000),
						account("Épargne logement", "depository", 310000),
						account("Compte courant", "depository", 125000),
					],
					total: toMinorUnits(1275000),
					excludedCount: 0,
				},
				{
					classification: "liability",
					accounts: [
						account("Carte Visa", "credit_card", 120000),
						account("Carte Amex", "credit_card", 45000),
					],
					total: toMinorUnits(165000),
					excludedCount: 0,
				},
			],
		} satisfies AccountListData;

		expect(accountsByName(list).map(({ name }) => name)).toEqual([
			"Compte courant",
			"Épargne logement",
			"Livret A",
			"Carte Amex",
			"Carte Visa",
		]);
	});
});
