import type { AccountGroupData, AccountListData, AccountSummaryData } from "@/hooks/useAccounts";

import type { AccountType } from "@archant/data/account-types";
import { ACCOUNT_TYPE_IDS, CLASSIFICATIONS, classificationOf } from "@archant/data/account-types";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";

/**
 * Sure's order of account types, assets then liabilities, each class in the
 * order of `ACCOUNT_TYPES`: the weight bar, its legend and the accounts
 * column's groups.
 */
export const TYPE_ORDER: readonly AccountType[] = CLASSIFICATIONS.flatMap((classification) =>
	ACCOUNT_TYPE_IDS.filter((type) => classificationOf(type) === classification),
);

/**
 * Whether an account counts in its class's total, as the API's does: active,
 * included in reports, and held in the reporting currency.
 */
export function countsInReports(account: AccountSummaryData, reportingCurrency: string): boolean {
	return account.active && !account.excludedFromReports && account.currency === reportingCurrency;
}

type BalanceSheetType = {
	type: AccountType;
	amount: MinorUnits;
	/** The type's sum over the group's total, between 0 and 1 in the usual case. */
	share: number;
};

type BalanceSheetAccount = {
	account: AccountSummaryData;
	/**
	 * The balance over the side's total, in percent, excluded or not, as Sure's
	 * row; null for a foreign-currency account, which `/accounts` gives no
	 * converted balance to weigh.
	 */
	weight: number | null;
};

export type BalanceSheetRow = {
	type: AccountType;
	/** The type's counted sum, the accounts outside the side's total left out. */
	total: MinorUnits;
	/** The total over the side's total, in percent. */
	weight: number;
	/** The type's active accounts, the ones outside the total included, in the API's order. */
	accounts: BalanceSheetAccount[];
};

export type BalanceSheetGroup = {
	classification: AccountGroupData["classification"];
	/** The API's group total, never recomputed here. */
	total: MinorUnits;
	/** The segments of the weight bar and the entries of its legend. */
	types: BalanceSheetType[];
	/** One row per type with an active account, Sure's collapsible rows. */
	rows: BalanceSheetRow[];
};

/**
 * An amount over a total, in percent, 0 when the total is 0 as Sure's
 * `AccountGroup#weight`. Multiplied before dividing, so an exact share stays
 * exact: 3 / 5 * 100 would read 60.00000000000001 and light a fourth bar.
 */
function percentOf(amount: MinorUnits, total: MinorUnits): number {
	return total === 0 ? 0 : (amount * 100) / total;
}

/** Sure's `_group_weight` draws five bars. */
export const WEIGHT_BARS = 5;

/** How many of Sure's five weight bars a weight in percent lights, one per 20 % begun. */
export function litBars(weight: number): number {
	return Math.min(WEIGHT_BARS, Math.max(0, Math.ceil(weight / (100 / WEIGHT_BARS))));
}

/**
 * The balance sheet by account type, from `/accounts` alone: the accounts column
 * reads the same query, so no second endpoint has to agree with it. A type's
 * share counts the accounts the API's total counts (active, included in
 * reports, in the reporting currency), so the shares add up to that total. A
 * type whose sum is zero or less, such as an overdrawn checking account, has
 * no segment; nor has any type when the group's total is zero or less. Its
 * row, though, lists every active account of the type, as Sure's does.
 */
export function balanceSheet(list: AccountListData): BalanceSheetGroup[] {
	return list.groups.map((group) => {
		const counted = group.accounts.filter((account) =>
			countsInReports(account, list.reportingCurrency),
		);
		const sums = new Map<AccountType, MinorUnits>(
			TYPE_ORDER.map((type) => [
				type,
				toMinorUnits(
					counted
						.filter((account) => account.type === type)
						.reduce((sum, account) => sum + account.balance, 0),
				),
			]),
		);
		const sumOf = (type: AccountType) => sums.get(type) ?? toMinorUnits(0);
		const types =
			group.total <= 0
				? []
				: TYPE_ORDER.flatMap((type) => {
						const amount = sumOf(type);

						return amount <= 0 ? [] : [{ type, amount, share: amount / group.total }];
					});

		const accounts = group.accounts.filter((account) => account.active);
		const rows = TYPE_ORDER.flatMap((type) => {
			const ofType = accounts.filter((account) => account.type === type);

			if (ofType.length === 0) {
				return [];
			}

			const total = sumOf(type);

			return [
				{
					type,
					total,
					weight: percentOf(total, group.total),
					accounts: ofType.map((account) => ({
						account,
						weight:
							account.currency === list.reportingCurrency
								? percentOf(account.balance, group.total)
								: null,
					})),
				},
			];
		});

		return { classification: group.classification, total: group.total, types, rows };
	});
}
