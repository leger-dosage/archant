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
		/**
		 * Under `all`, not under one account: every write that moves a
		 * balance, flips an account's flags or adds an account already
		 * invalidates `all`, so the dashboard follows with no change to them.
		 */
		netWorth: (period: BalancePeriod) => ["accounts", "net-worth", period] as const,
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
	/** Every rule, one query: a household keeps a few dozen. */
	rules: {
		all: ["rules"] as const,
		/** Under `all`: every write to the rules, an application included, refreshes the runs. */
		runs: (page: number) => ["rules", "runs", page] as const,
		/** Under `all`, one rule's or, for `null`, every enabled rule's count. */
		preview: (ruleId: string | null) => ["rules", "preview", ruleId] as const,
	},
	/**
	 * Every recurring pattern, one query: a household has a few dozen. Not
	 * invalidated by transaction writes: a confirmed or reverted import, which
	 * runs the detection, invalidates it, and once stale the page refetches it
	 * on mount.
	 */
	recurring: {
		all: ["recurring"] as const,
		/** Under `all`: adding, confirming or detecting refreshes the sheet's series. */
		ofEntry: (entryId: string) => ["recurring", "entry", entryId] as const,
	},
	/**
	 * Bank connections. `setup` changes when credentials are saved, and when a
	 * connection completes or goes, since an active one locks them; a new
	 * connection also invalidates `list`. `institutions` never changes while
	 * the page is open. Linking rewrites `accounts(id)` from its own answer; a
	 * disconnection drops it.
	 */
	bankConnections: {
		setup: ["bank-connections", "setup"] as const,
		list: ["bank-connections", "list"] as const,
		institutions: (country: string) => ["bank-connections", "institutions", country] as const,
		accounts: (connectionId: string) => ["bank-connections", "accounts", connectionId] as const,
	},
	/** The running release. */
	version: ["version"] as const,
	/**
	 * Connected assistants, with the address to give one. A disconnection
	 * invalidates `all`; `client(id)` is the consent page's, read once.
	 */
	assistants: {
		all: ["assistants"] as const,
		client: (clientId: string) => ["assistants", "client", clientId] as const,
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
		/**
		 * The count and the sums of the cross-account list under its filters.
		 * No page, so turning one reads them from the cache.
		 */
		totals: (filters: TransactionFilters) => ["transactions", "totals", filters] as const,
		/** The latest rows under its filters, a budget category's sheet's three. */
		recent: (filters: TransactionFilters) => ["transactions", "recent", filters] as const,
		/** Prefixes every page of one account's list. */
		ofAccount: (accountId: string) => ["transactions", "account", accountId] as const,
		byAccount: (accountId: string, page: number) =>
			["transactions", "account", accountId, page] as const,
		/**
		 * Under `all`: any transaction write can add or remove a candidate, and
		 * every one of them already invalidates `all`.
		 */
		transferCandidates: (transactionId: string) =>
			["transactions", "transfer-candidates", transactionId] as const,
		/** Under `all`, for the same reason as `transferCandidates`. */
		duplicateCandidates: (transactionId: string) =>
			["transactions", "duplicate-candidates", transactionId] as const,
		/**
		 * The dashboard's income and expenses of a month. Under `all`: every
		 * transaction, category-assignment, transfer and account-flag write
		 * already invalidates it, and so does a category's own edit, which
		 * renames or recolours a line.
		 */
		cashFlow: (month: string) => ["transactions", "cash-flow", month] as const,
		/**
		 * A month's budget with its actuals and suggestions. Under `all`, as
		 * `cashFlow`: every write that moves the month's cash flow refreshes it.
		 */
		budget: (month: string) => ["transactions", "budget", month] as const,
		/**
		 * Prefixes every month's budget: a month set up becomes the one a later
		 * month offers to copy, and any budget write can change what a later
		 * month receives, so every budget write stales the others.
		 */
		budgets: ["transactions", "budget"] as const,
	},
};
