import type { TransactionFilters } from "@/lib/transaction-filters";

import type { BalancePeriod } from "@archant/api/schemas/balances";

// One entry per resource, so an invalidation after a write names exactly the
// queries it makes stale. `accounts.all` prefixes every account query.
export const queryKeys = {
	accounts: {
		all: ["accounts"] as const,
		detail: (id: string) => ["accounts", "detail", id] as const,
		/**
		 * Under `detail(id)`, so every transaction write, which invalidates the
		 * account, redraws its chart with no change to the mutations.
		 */
		balances: (id: string, period: BalancePeriod) =>
			["accounts", "detail", id, "balances", period] as const,
		/**
		 * Under `detail(id)` too: a snapshot's gap depends on the transactions
		 * of its day, so every transaction write must refresh the table.
		 */
		snapshots: (id: string, page: number) => ["accounts", "detail", id, "snapshots", page] as const,
	},
	transactions: {
		/**
		 * Prefixes every transaction list, one account's or all of them. A
		 * write invalidates it whole: an edit on an account page changes a row
		 * of the cross-account list, and the other way round.
		 */
		all: ["transactions"] as const,
		/** A page of the cross-account list under its filters. */
		list: (filters: TransactionFilters, page: number) =>
			["transactions", "list", filters, page] as const,
		byAccount: (accountId: string, page: number) =>
			["transactions", "account", accountId, page] as const,
	},
};
