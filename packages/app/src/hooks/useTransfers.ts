import type { InferResponseType } from "hono/client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { TransferInput } from "@archant/api/schemas/transfers";

import { api, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export type TransferCandidateData = InferResponseType<
	(typeof api.transactions)[":id"]["transfer-candidates"]["$get"],
	200
>["data"][number];

/** The transactions that can be the other side of `transactionId`'s transfer, closest date first. */
export function useTransferCandidates(transactionId: string, enabled: boolean) {
	return useQuery({
		queryKey: queryKeys.transactions.transferCandidates(transactionId),
		queryFn: async () =>
			(
				await unwrap(
					api.transactions[":id"]["transfer-candidates"].$get({ param: { id: transactionId } }),
				)
			).data,
		enabled,
	});
}

/**
 * Refreshes every transaction list, and the candidates with them. No balance
 * moves and no count changes, so nothing else; no optimistic update, as both
 * rows of a transfer change and only one may be on screen.
 */
function useInvalidateTransactions() {
	const queryClient = useQueryClient();

	return () => queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all });
}

export function useMatchTransfer() {
	const invalidate = useInvalidateTransactions();

	return useMutation({
		mutationFn: async (input: TransferInput) =>
			(await unwrap(api.transfers.$post({ json: input }))).data,
		// A refused pick is usually a candidate matched or changed meanwhile:
		// the picker must stop offering it.
		onSettled: invalidate,
	});
}

/** Undoes a transfer and refuses its pair for good: « Ne plus proposer ». */
export function useRejectTransfer() {
	const invalidate = useInvalidateTransactions();

	return useMutation({
		mutationFn: async (id: string) =>
			(await unwrap(api.transfers[":id"].reject.$post({ param: { id } }))).data,
		onSuccess: invalidate,
	});
}

export function useUnmatchTransfer() {
	const invalidate = useInvalidateTransactions();

	return useMutation({
		mutationFn: async (id: string) =>
			(await unwrap(api.transfers[":id"].$delete({ param: { id } }))).data,
		onSuccess: invalidate,
	});
}
