import type { AccountListData, AccountSummaryData } from "@/hooks/useAccounts";

const byName = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

/**
 * Every account of the list, assets then liabilities, each class by name.
 * The API sorts its groups in the user's order (Sure's
 * `default_account_order`), which only the account lists follow: a picker
 * lists accounts by name whatever the order, as Sure's `alphabetically`.
 */
export function accountsByName(list: AccountListData): AccountSummaryData[] {
	return list.groups.flatMap((group) =>
		group.accounts.toSorted((a, b) => byName.compare(a.name, b.name)),
	);
}
