// One entry per resource, so an invalidation after a write names exactly the
// queries it makes stale. `accounts.all` prefixes every account query.
export const queryKeys = {
	accounts: {
		all: ["accounts"] as const,
		detail: (id: string) => ["accounts", "detail", id] as const,
	},
	transactions: {
		byAccount: (accountId: string, page: number) =>
			["transactions", "account", accountId, page] as const,
		/** Every page of one account's transactions. */
		account: (accountId: string) => ["transactions", "account", accountId] as const,
	},
};
