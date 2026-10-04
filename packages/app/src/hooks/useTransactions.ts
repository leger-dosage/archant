import type { TransactionFilters } from "@/lib/transaction-filters";
import type { InferResponseType } from "hono/client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { t } from "i18next";
import { toast } from "sonner";

import type {
	BulkDeleteInput,
	BulkUpdateInput,
	SplitInput,
	TransactionInput,
	TransactionPatchInput,
} from "@archant/api/schemas/transactions";

import { useInvalidateAccount } from "@/hooks/useInvalidateAccount";
import { api, errorCodeOf, unwrap } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";
import { queryKeys } from "@/lib/query-keys";
import { toApiQuery, toTotalsQuery } from "@/lib/transaction-filters";

type TransactionPageData = InferResponseType<
	(typeof api.accounts)[":id"]["transactions"]["$get"],
	200
>["data"];
export type TransactionData = TransactionPageData["items"][number];
export type SplitData = InferResponseType<
	(typeof api.transactions)[":id"]["split"]["$get"],
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

/** A page of every account's transactions under `filters`; `useTransactionTotals` counts them. */
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

/**
 * The count and the sums of every transaction under `filters`, whatever the
 * page: the server sums every matching row, which a page change must not rerun.
 */
export function useTransactionTotals(filters: TransactionFilters) {
	return useQuery({
		queryKey: queryKeys.transactions.totals(filters),
		queryFn: async () =>
			(await unwrap(api.transactions.totals.$get({ query: toTotalsQuery(filters) }))).data,
		// The previous figures stay while a new filter's load, as the rows do.
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
		// The sheet can change the category, the merchant and the tags too, and
		// with them their counts; a new label or merchant changes the series the
		// sheet names.
		onSuccess: () =>
			Promise.all([
				invalidate(),
				queryClient.invalidateQueries({ queryKey: queryKeys.categories.all }),
				queryClient.invalidateQueries({ queryKey: queryKeys.merchants.all }),
				queryClient.invalidateQueries({ queryKey: queryKeys.tags.all }),
				queryClient.invalidateQueries({ queryKey: queryKeys.recurring.all }),
			]),
	});
}

/** The fields a row edits in place, with an optimistic update and « Annuler ». */
type RowValues = { categoryId: string | null };

type RowField = keyof RowValues;

type RowChange<Field extends RowField> = {
	id: string;
	value: RowValues[Field];
	/** What the row showed before, for « Annuler ». */
	previous: RowValues[Field];
	/** An undo shows no toast of its own: it would offer to undo the undo. */
	undo?: boolean;
};

/**
 * Any cached query under `transactions.all`. Only a page of transactions, one
 * account's or the cross-account list, has `items`: the dashboard's cash flow
 * and a row's transfer candidates share the prefix so that every write
 * refreshes them, and the optimistic write must leave them alone.
 */
type CachedPage = { items?: TransactionData[] } | undefined;

const ROW_FIELDS = {
	categoryId: {
		changed: "transactions.category.changed",
		undo: "transactions.category.undo",
		toast: "category",
		counts: queryKeys.categories.all,
	},
} as const;

/**
 * Sets one row's category from the list. The row changes at once
 * in every cached list; a success toast offers « Annuler », which sets the
 * previous value back, by hand again, so it stays locked. A failure puts the
 * rows back and shows a destructive toast.
 */
function useSetRowField<Field extends RowField>(field: Field) {
	const queryClient = useQueryClient();
	const texts = ROW_FIELDS[field];
	const patchOf = (value: RowValues[Field]): Partial<RowValues> => ({ [field]: value });

	const mutation = useMutation({
		mutationFn: async ({ id, value }: RowChange<Field>) =>
			(await unwrap(api.transactions[":id"].$patch({ param: { id }, json: patchOf(value) }))).data,
		onMutate: async ({ id, value }: RowChange<Field>) => {
			// A refetch landing after the optimistic write would show the old value again.
			await queryClient.cancelQueries({ queryKey: queryKeys.transactions.all });
			const snapshot = queryClient.getQueriesData<CachedPage>({
				queryKey: queryKeys.transactions.all,
			});

			queryClient.setQueriesData<CachedPage>({ queryKey: queryKeys.transactions.all }, (page) =>
				page?.items === undefined
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

export function useDeleteTransaction(accountId: string) {
	const invalidate = useInvalidateAccount(accountId);

	return useMutation({
		mutationFn: async (id: string) =>
			(await unwrap(api.transactions[":id"].$delete({ param: { id } }))).data,
		onSuccess: invalidate,
	});
}

/**
 * Refreshes what a bulk action or a rule application can change: every
 * transaction list, the category, merchant and tag counts, and, with
 * `balances`, every account. No optimistic update: the rows a filter or a
 * rule selects are not all on screen.
 */
export function useInvalidateBulk() {
	const queryClient = useQueryClient();

	return (options: { balances: boolean }) =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all }),
			queryClient.invalidateQueries({ queryKey: queryKeys.categories.all }),
			queryClient.invalidateQueries({ queryKey: queryKeys.merchants.all }),
			queryClient.invalidateQueries({ queryKey: queryKeys.tags.all }),
			queryClient.invalidateQueries({
				queryKey: options.balances ? queryKeys.accounts.all : queryKeys.accounts.goals,
			}),
		]);
}

export type BulkPatch = BulkUpdateInput["patch"];

/** Sets a category or a merchant, adds tags or changes the exclusion on a selection. */
export function useBulkUpdateTransactions() {
	const invalidate = useInvalidateBulk();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (input: BulkUpdateInput) =>
			(await unwrap(api.transactions["bulk-update"].$post({ json: input }))).data,
		// A new merchant changes the series the sheet names.
		onSuccess: () =>
			Promise.all([
				invalidate({ balances: false }),
				queryClient.invalidateQueries({ queryKey: queryKeys.recurring.all }),
			]),
		onError: (error) => showErrorToast(errorCodeOf(error)),
	});
}

/** Deletes a selection for good; the balances of their accounts follow. */
export function useBulkDeleteTransactions() {
	const invalidate = useInvalidateBulk();

	return useMutation({
		mutationFn: async (input: BulkDeleteInput) =>
			(await unwrap(api.transactions["bulk-delete"].$post({ json: input }))).data,
		onSuccess: () => invalidate({ balances: true }),
		onError: (error) => showErrorToast(errorCodeOf(error)),
	});
}

/** How many rows a category's sheet lists, as Sure's `take(3)`. */
const RECENT_COUNT = 3;

/**
 * The first rows of the list a category's sheet links to: the same filter,
 * the same order, so the sheet never shows a row the list would not.
 */
export function useRecentTransactions(filters: TransactionFilters, enabled: boolean) {
	return useQuery({
		queryKey: queryKeys.transactions.recent(filters),
		queryFn: async () =>
			(
				await unwrap(
					api.transactions.$get({
						query: { ...toApiQuery(filters, 1), pageSize: String(RECENT_COUNT) },
					}),
				)
			).data.items,
		enabled,
	});
}

/** The split `id` belongs to, read from its parent or one of its lines. */
export function useSplit(id: string, enabled: boolean) {
	return useQuery({
		queryKey: queryKeys.transactions.split(id),
		queryFn: async () => (await unwrap(api.transactions[":id"].split.$get({ param: { id } }))).data,
		enabled,
		// A split undone or deleted elsewhere stays gone: the sheet's block says
		// so inline at once rather than after the retries' backoff.
		retry: (failures, error) => errorCodeOf(error) !== "NOT_FOUND" && failures < 3,
		meta: { notFoundInline: true },
	});
}

/**
 * Refreshes what a split, its edit or its undoing changes: the lists with
 * their totals, the category and tag counts, the splits and the series,
 * whose rows it moves. No balance moves: the lines sum to the parent. Every
 * split action closes the sheet, so its split is dropped and the series only
 * marked stale, both read again on the next opening: a line the action
 * deleted answers NOT_FOUND, and refetching it through every retry would
 * hold the mutation for seconds.
 */
function useInvalidateSplit() {
	const invalidate = useInvalidateBulk();
	const queryClient = useQueryClient();

	return () => {
		queryClient.removeQueries({ queryKey: queryKeys.transactions.splits });

		return Promise.all([
			invalidate({ balances: false }),
			queryClient.invalidateQueries({ queryKey: queryKeys.recurring.all, refetchType: "none" }),
		]);
	};
}

/** Splits a transaction into lines, as Sure's « Diviser ». */
export function useSplitTransaction() {
	const invalidate = useInvalidateSplit();

	return useMutation({
		mutationFn: async ({ id, input }: { id: string; input: SplitInput }) =>
			(await unwrap(api.transactions[":id"].split.$post({ param: { id }, json: input }))).data,
		onSuccess: invalidate,
	});
}

/** Replaces a split's lines, keeping those sent with their id. */
export function useEditSplit() {
	const invalidate = useInvalidateSplit();

	return useMutation({
		mutationFn: async ({ id, input }: { id: string; input: SplitInput }) =>
			(await unwrap(api.transactions[":id"].split.$put({ param: { id }, json: input }))).data,
		onSuccess: invalidate,
	});
}

/** Deletes a split's lines and counts its parent again. */
export function useUnsplitTransaction() {
	const invalidate = useInvalidateSplit();

	return useMutation({
		mutationFn: async (id: string) =>
			(await unwrap(api.transactions[":id"].split.$delete({ param: { id } }))).data,
		onSuccess: invalidate,
	});
}
