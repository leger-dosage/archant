import type { InferResponseType } from "hono/client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { TransactionInput, TransactionPatchInput } from "@archant/api/schemas/transactions";

import { api, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export type TransactionPageData = InferResponseType<
	(typeof api.accounts)[":id"]["transactions"]["$get"],
	200
>["data"];
export type TransactionData = TransactionPageData["items"][number];

export function useAccountTransactions(accountId: string, page: number) {
	return useQuery({
		queryKey: queryKeys.transactions.byAccount(accountId, page),
		queryFn: async () =>
			(
				await unwrap(
					api.accounts[":id"].transactions.$get({
						param: { id: accountId },
						query: { page: String(page) },
					}),
				)
			).data,
		// Keeps the current page on screen while the next one loads, but never
		// another account's rows: opening one would edit the wrong account.
		placeholderData: (previous, previousQuery) =>
			previousQuery?.queryKey[2] === accountId ? previous : undefined,
	});
}

/**
 * A transaction changes its account's balance, which the account page, the
 * accounts page and the sidebar all show: every write refreshes the three.
 */
function useInvalidateAccount(accountId: string) {
	const queryClient = useQueryClient();

	return () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: queryKeys.accounts.all }),
			queryClient.invalidateQueries({ queryKey: queryKeys.accounts.detail(accountId) }),
			queryClient.invalidateQueries({ queryKey: queryKeys.transactions.account(accountId) }),
		]);
}

export function useCreateTransaction(accountId: string) {
	const invalidate = useInvalidateAccount(accountId);

	return useMutation({
		mutationFn: async (input: TransactionInput) =>
			(
				await unwrap(
					api.accounts[":id"].transactions.$post({ param: { id: accountId }, json: input }),
				)
			).data,
		onSuccess: invalidate,
	});
}

export function useUpdateTransaction(accountId: string) {
	const invalidate = useInvalidateAccount(accountId);

	return useMutation({
		mutationFn: async ({ id, input }: { id: string; input: TransactionPatchInput }) =>
			(await unwrap(api.transactions[":id"].$patch({ param: { id }, json: input }))).data,
		onSuccess: invalidate,
	});
}

export function useDeleteTransaction(accountId: string) {
	const invalidate = useInvalidateAccount(accountId);

	return useMutation({
		mutationFn: async (id: string) =>
			(await unwrap(api.transactions[":id"].$delete({ param: { id } }))).data,
		onSuccess: invalidate,
	});
}
