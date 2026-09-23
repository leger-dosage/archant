import type { TransactionFilters } from "@/lib/transaction-filters";

import type { BalancePeriod } from "@archant/api/schemas/balances";

// One entry per resource, so an invalidation after a write names exactly the
// queries it makes stale. `accounts.all` prefixes every account query.
export const queryKeys = {
	/** Better Auth's session, `null` when signed out (lib/auth-client.ts). */
	session: ["session"] as const,
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
		/**
		 * Under `detail(id)` too: confirming an import adds a row, and any
		 * transaction write can change what a revert would delete.
		 */
		imports: (id: string, page: number) => ["accounts", "detail", id, "imports", page] as const,
	},
	/** The whole category list, one query: a household keeps a few dozen. */
	categories: {
		all: ["categories"] as const,
	},
	/** The whole merchant list, one query: each row's merchant name is read from it. */
	merchants: {
		all: ["merchants"] as const,
	},
	/** The whole tag list, one query: each row's tag names are read from it. */
	tags: {
		all: ["tags"] as const,
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
		/** Prefixes every page of one account's list. */
		ofAccount: (accountId: string) => ["transactions", "account", accountId] as const,
		byAccount: (accountId: string, page: number) =>
			["transactions", "account", accountId, page] as const,
	},
};
