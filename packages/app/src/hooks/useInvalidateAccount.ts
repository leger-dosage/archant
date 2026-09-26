import { useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-keys";

/**
 * Refreshes everything a write on one account can change. Its balance, name
 * and flags show on its page, the accounts page, the sidebar and every
 * transaction list, and its detail holds the chart and the Soldes table:
 * every write refreshes them all.
 */
export function useInvalidateAccount(accountId: string) {
	const queryClient = useQueryClient();

	return () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: queryKeys.accounts.all }),
			queryClient.invalidateQueries({ queryKey: queryKeys.accounts.detail(accountId) }),
			queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all }),
		]);
}
