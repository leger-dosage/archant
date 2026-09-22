import type { TransactionFilters } from "@/lib/transaction-filters";
import type { InferResponseType } from "hono/client";

import { useMutation, useQuery } from "@tanstack/react-query";

import type { TransactionInput, TransactionPatchInput } from "@archant/api/schemas/transactions";

import { useInvalidateAccount } from "@/hooks/useInvalidateAccount";
import { api, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { toApiQuery } from "@/lib/transaction-filters";

export type TransactionPageData = InferResponseType<
	(typeof api.accounts)[":id"]["transactions"]["$get"],
	200
>["data"];
export type TransactionData = TransactionPageData["items"][number];

export type FilteredTransactionPageData = InferResponseType<
	(typeof api.transactions)["$get"],
	200
>["data"];

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

/** A page of every account's transactions under `filters`, with its count and total. */
export function useTransactions(filters: TransactionFilters, page: number) {
	return useQuery({
		queryKey: queryKeys.transactions.list(filters, page),
		queryFn: async () =>
			(await unwrap(api.transactions.$get({ query: toApiQuery(filters, page) }))).data,
		// The rows stay on screen while the next page or filter loads; the
		// sheet reads the account from each row, so no row can be edited
		// against the wrong account.
		placeholderData: (previous) => previous,
	});
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
