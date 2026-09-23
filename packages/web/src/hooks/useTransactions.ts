import type { TransactionFilters } from "@/lib/transaction-filters";
import type { InferResponseType } from "hono/client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { t } from "i18next";
import { toast } from "sonner";

import type { TransactionInput, TransactionPatchInput } from "@archant/api/schemas/transactions";

import { useInvalidateAccount } from "@/hooks/useInvalidateAccount";
import { api, errorCodeOf, unwrap } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";
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
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({ id, input }: { id: string; input: TransactionPatchInput }) =>
			(await unwrap(api.transactions[":id"].$patch({ param: { id }, json: input }))).data,
		// The sheet can change the category and the merchant too, and with them their counts.
		onSuccess: () =>
			Promise.all([
				invalidate(),
				queryClient.invalidateQueries({ queryKey: queryKeys.categories.all }),
				queryClient.invalidateQueries({ queryKey: queryKeys.merchants.all }),
			]),
	});
}

/** A field a row edits in place, with an optimistic update and « Annuler ». */
type RowField = "categoryId" | "merchantId";

type RowChange = {
	id: string;
	value: string | null;
	/** What the row showed before, for « Annuler ». */
	previous: string | null;
	/** An undo shows no toast of its own: it would offer to undo the undo. */
	undo?: boolean;
};

/** Any cached page of transactions, one account's or the cross-account list. */
type CachedPage = { items: TransactionData[] } | undefined;

const ROW_FIELDS = {
	categoryId: {
		changed: "transactions.category.changed",
		undo: "transactions.category.undo",
		toast: "category",
		counts: queryKeys.categories.all,
	},
	merchantId: {
		changed: "transactions.merchant.changed",
		undo: "transactions.merchant.undo",
		toast: "merchant",
		counts: queryKeys.merchants.all,
	},
} as const;

/**
 * Sets one row's category or merchant from the list. The row changes at once
 * in every cached list; a success toast offers « Annuler », which sets the
 * previous value back, by hand again, so it stays locked. A failure puts the
 * rows back and shows a destructive toast.
 */
function useSetRowField(field: RowField) {
	const queryClient = useQueryClient();
	const texts = ROW_FIELDS[field];
	const patchOf = (value: string | null) =>
		field === "categoryId" ? { categoryId: value } : { merchantId: value };

	const mutation = useMutation({
		mutationFn: async ({ id, value }: RowChange) =>
			(await unwrap(api.transactions[":id"].$patch({ param: { id }, json: patchOf(value) }))).data,
		onMutate: async ({ id, value }: RowChange) => {
			// A refetch landing after the optimistic write would show the old value again.
			await queryClient.cancelQueries({ queryKey: queryKeys.transactions.all });
			const snapshot = queryClient.getQueriesData<CachedPage>({
				queryKey: queryKeys.transactions.all,
			});

			queryClient.setQueriesData<CachedPage>({ queryKey: queryKeys.transactions.all }, (page) =>
				page === undefined
					? page
					: {
							...page,
							items: page.items.map((item) =>
								item.id === id ? { ...item, ...patchOf(value) } : item,
							),
						},
			);

			return { snapshot };
		},
		onError: (error, _change, context) => {
			for (const [key, data] of context?.snapshot ?? []) {
				queryClient.setQueryData(key, data);
			}
			showErrorToast(errorCodeOf(error));
		},
		onSuccess: (_data, change) => {
			if (change.undo === true) {
				return;
			}

			// One toast per row and field: a newer choice replaces the older
			// toast, whose « Annuler » would otherwise overwrite it.
			const id = `${texts.toast}-${change.id}`;

			toast.success(t(texts.changed), {
				id,
				action: {
					label: t(texts.undo),
					onClick: () => {
						toast.dismiss(id);
						mutation.mutate({
							id: change.id,
							value: change.previous,
							previous: change.value,
							undo: true,
						});
					},
				},
			});
		},
		// A filtered list may have to drop the row, and a count moved.
		onSettled: () =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all }),
				queryClient.invalidateQueries({ queryKey: texts.counts }),
			]),
	});

	return mutation;
}

export function useSetTransactionCategory() {
	return useSetRowField("categoryId");
}

export function useSetTransactionMerchant() {
	return useSetRowField("merchantId");
}

export function useDeleteTransaction(accountId: string) {
	const invalidate = useInvalidateAccount(accountId);

	return useMutation({
		mutationFn: async (id: string) =>
			(await unwrap(api.transactions[":id"].$delete({ param: { id } }))).data,
		onSuccess: invalidate,
	});
}
