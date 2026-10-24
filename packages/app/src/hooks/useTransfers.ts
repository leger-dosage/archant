import type { InferResponseType } from "hono/client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
	NewTransferInput,
	TransferInput,
	TransferPatchInput,
} from "@archant/api/schemas/transfers";

import { api, errorCodeOf, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export type TransferCandidateData = InferResponseType<
	(typeof api.transactions)[":id"]["transfer-candidates"]["$get"],
	200
>["data"][number];

export type TransferDetailsData = InferResponseType<
	(typeof api.transfers)[":id"]["$get"],
	200
>["data"];

/** What a transfer's drawer shows, as Sure's `transfers#show`. */
export function useTransfer(transferId: string | null) {
	return useQuery({
		queryKey: queryKeys.transactions.transfer(transferId ?? ""),
		queryFn: async () =>
			(await unwrap(api.transfers[":id"].$get({ param: { id: transferId ?? "" } }))).data,
		enabled: transferId !== null,
		refetchOnMount: "always",
		// Deleted from the drawer, it answers `NOT_FOUND` for good: retrying would
		// hold the deletion's refresh, and the drawer's closing, by the backoff.
		retry: (failureCount, error) =>
			!["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND"].includes(errorCodeOf(error)) && failureCount < 3,
	});
}

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
 * Refreshes every transaction list, and the candidates with them, and the
 * accounts: undoing a transfer created with fees deletes its fee lines, which
 * moves balances. No optimistic update, as both rows of a transfer change and
 * only one may be on screen.
 */
function useInvalidateTransactions() {
	const queryClient = useQueryClient();

	return () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all }),
			queryClient.invalidateQueries({ queryKey: queryKeys.accounts.all }),
		]);
}

export function useMatchTransfer() {
	const queryClient = useQueryClient();
	const invalidate = useInvalidateTransactions();

	return useMutation({
		mutationFn: async (input: TransferInput) =>
			(await unwrap(api.transfers.$post({ json: input }))).data,
		// A refused pick is usually a candidate matched or changed meanwhile:
		// the picker must stop offering it. A contribution may create
		// « Contributions aux investissements ».
		onSettled: () =>
			Promise.all([
				invalidate(),
				queryClient.invalidateQueries({ queryKey: queryKeys.categories.all }),
			]),
	});
}

/** Confirms a transfer the matcher proposed, as Sure's « Confirmer la correspondance ». */
export function useConfirmTransfer() {
	const invalidate = useInvalidateTransactions();

	return useMutation({
		mutationFn: async (id: string) =>
			(await unwrap(api.transfers[":id"].confirm.$post({ param: { id } }))).data,
		onSuccess: invalidate,
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

/**
 * Creates a transfer between two accounts from « Virement », as Sure's
 * `transfers#create`: both balances move, so every account and list refreshes.
 */
export function useCreateTransferBetween() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (input: NewTransferInput) =>
			(await unwrap(api.transfers.new.$post({ json: input }))).data,
		onSuccess: () =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: queryKeys.accounts.all }),
				queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all }),
				// A first fee creates « Frais », a contribution « Contributions aux investissements ».
				queryClient.invalidateQueries({ queryKey: queryKeys.categories.all }),
			]),
	});
}

/**
 * Saves the drawer's category or notes, as Sure's `transfers#update`; a
 * category moves the reports, so the categories go stale with the lists.
 * Marked stale rather than refetched: the drawer's open picker reads them, and
 * a refetch under it took the focus and with it the next `Escape`.
 */
export function useUpdateTransfer(transferId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (input: TransferPatchInput) =>
			(await unwrap(api.transfers[":id"].$patch({ param: { id: transferId }, json: input }))).data,
		onSuccess: () =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all }),
				queryClient.invalidateQueries({
					queryKey: queryKeys.categories.all,
					refetchType: "inactive",
				}),
			]),
	});
}

/**
 * Sets the same tags on both sides, as Sure's `update_tags`; the tags' counts
 * go stale, not refetched under the open picker, as `useUpdateTransfer`'s categories.
 */
export function useSetTransferTags(transferId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		// One at a time, in the order picked: each sends the whole set, and an
		// older one landing last would put back a tag just removed.
		scope: { id: `transfer-tags-${transferId}` },
		mutationFn: async (tagIds: string[]) =>
			(
				await unwrap(
					api.transfers[":id"].tags.$put({ param: { id: transferId }, json: { tagIds } }),
				)
			).data,
		onSuccess: () =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all }),
				queryClient.invalidateQueries({ queryKey: queryKeys.tags.all, refetchType: "inactive" }),
			]),
	});
}
