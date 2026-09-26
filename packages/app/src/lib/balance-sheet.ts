import type { AccountGroupData, AccountListData, AccountSummaryData } from "@/hooks/useAccounts";

import type { AccountType } from "@archant/data/account-types";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";

/** The order of the weight bar and its legend: Sure's, assets then liabilities. */
const TYPE_ORDER: readonly AccountType[] = [
	"depository",
	"investment",
	"property",
	"vehicle",
	"credit_card",
	"loan",
];

export type BalanceSheetType = {
	type: AccountType;
	amount: MinorUnits;
	/** The type's sum over the group's total, between 0 and 1 in the usual case. */
	share: number;
};

export type BalanceSheetGroup = {
	classification: AccountGroupData["classification"];
	/** The API's group total, never recomputed here. */
	total: MinorUnits;
	/** The segments of the weight bar and the entries of its legend. */
	types: BalanceSheetType[];
	/** Every active account of the group, the ones outside the total included. */
	accounts: AccountSummaryData[];
};

/**
 * The balance sheet by account type, from `/accounts` alone: the sidebar
 * reads the same query, so no second endpoint has to agree with it. A type's
 * share counts the accounts the API's total counts (active, included in
 * reports, in the reporting currency), so the shares add up to that total. A
 * type whose sum is zero or less, such as an overdrawn checking account, has
 * no segment; nor has any type when the group's total is zero or less.
 */
export function balanceSheet(list: AccountListData): BalanceSheetGroup[] {
	return list.groups.map((group) => {
		const counted = group.accounts.filter(
			(account) =>
				account.active &&
				!account.excludedFromReports &&
				account.currency === list.reportingCurrency,
		);
		const types =
			group.total <= 0
				? []
				: TYPE_ORDER.flatMap((type) => {
						const amount = counted
							.filter((account) => account.type === type)
							.reduce((sum, account) => sum + account.balance, 0);

						return amount <= 0
							? []
							: [{ type, amount: toMinorUnits(amount), share: amount / group.total }];
					});

		return {
			classification: group.classification,
			total: group.total,
			types,
			accounts: group.accounts.filter((account) => account.active),
		};
	});
}
