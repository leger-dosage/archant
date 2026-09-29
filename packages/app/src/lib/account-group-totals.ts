import type { AccountListData, AccountSummaryData } from "@/hooks/useAccounts";

import type { AccountType, Classification } from "@archant/data/account-types";
import { classificationOf } from "@archant/data/account-types";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";

import { TYPE_ORDER, countsInReports } from "@/lib/balance-sheet";

/** The accounts column's tabs: Tout, Actifs, Passifs. */
export const ACCOUNT_TABS = ["all", "asset", "liability"] as const;

export type AccountTab = (typeof ACCOUNT_TABS)[number];

export function isAccountTab(value: string): value is AccountTab {
	return ACCOUNT_TABS.some((tab) => tab === value);
}

export type AccountTypeGroup = {
	type: AccountType;
	classification: Classification;
	/** The type's active accounts, the ones outside the total included. */
	accounts: AccountSummaryData[];
	total: MinorUnits;
	/**
	 * Active accounts of the type left out of its total only for their
	 * currency, as the API's classification `excludedCount`.
	 */
	excludedCount: number;
};

/**
 * The accounts column's groups: active accounts by type, in Sure's order,
 * assets then liabilities. A type's total counts what the API's
 * classification total counts, so the types of one class add up to it. A
 * type with no active account has no group.
 */
export function accountTypeGroups(list: AccountListData, tab: AccountTab): AccountTypeGroup[] {
	return list.groups
		.filter((group) => tab === "all" || group.classification === tab)
		.flatMap((group) =>
			TYPE_ORDER.filter((type) => classificationOf(type) === group.classification).flatMap(
				(type): AccountTypeGroup[] => {
					const accounts = group.accounts.filter(
						(account) => account.type === type && account.active,
					);

					if (accounts.length === 0) {
						return [];
					}

					const counted = accounts.filter((account) =>
						countsInReports(account, list.reportingCurrency),
					);
					const reported = accounts.filter((account) => !account.excludedFromReports);

					return [
						{
							type,
							classification: group.classification,
							accounts,
							total: toMinorUnits(counted.reduce((sum, account) => sum + account.balance, 0)),
							excludedCount: reported.length - counted.length,
						},
					];
				},
			),
		);
}
