import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useInvalidateBulk } from "@/hooks/useTransactions";
import { api, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/** The transactions a possible duplicate may be merged into, nearest date first. */
export function useDuplicateCandidates(transactionId: string, enabled: boolean) {
	return useQuery({
		queryKey: queryKeys.transactions.duplicateCandidates(transactionId),
		queryFn: async () =>
			(
				await unwrap(
					api.transactions[":id"]["duplicate-candidates"].$get({ param: { id: transactionId } }),
				)
			).data,
		enabled,
	});
}

/**
 * Merges a possible duplicate into the candidate picked. A row goes, the
 * balances from its date move, and the survivor may gain tags, so every list,
 * count and account refreshes. Settled rather than succeeded: a refusal is
 * usually a merge or a dismissal in another tab, which the sheet must catch
 * up with.
 */
export function useMergeDuplicate() {
	const invalidate = useInvalidateBulk();

	return useMutation({
		mutationFn: async ({ id, into }: { id: string; into: string }) =>
			(await unwrap(api.transactions[":id"].merge.$post({ param: { id }, json: { into } }))).data,
		// Not awaited: the refetch drops the merged row, and the sheet showing it
		// must still hear of the success to close and move focus.
		onSettled: () => {
			void invalidate({ balances: true });
		},
	});
}

/** Clears the flag: « Ce n'est pas un doublon ». Only the rows change. */
export function useDismissDuplicate() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (id: string) =>
			(await unwrap(api.transactions[":id"]["dismiss-duplicate"].$post({ param: { id } }))).data,
		onSettled: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all });
		},
	});
}
