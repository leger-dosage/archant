import type { QueryClient } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
	BudgetCategoryInput,
	BudgetInput,
	BudgetMoveInput,
} from "@archant/api/schemas/budgets";

import { api, errorCodeOf, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export type BudgetData = InferResponseType<(typeof api.budgets)[":month"]["$get"], 200>["data"];

/** An expense category's envelope in the month. */
export type BudgetCategoryData = BudgetData["categories"][number];

/** « Sans catégorie »'s envelope, what the total leaves unallocated. */
export type UncategorisedData = BudgetData["uncategorised"];

export function useBudget(month: string) {
	return useQuery({
		queryKey: queryKeys.transactions.budget(month),
		queryFn: async () => (await unwrap(api.budgets[":month"].$get({ param: { month } }))).data,
		// A month out of bounds stays out: retrying would only delay saying so.
		retry: (failureCount, error) =>
			!["NOT_FOUND", "VALIDATION_ERROR", "UNAUTHORIZED"].includes(errorCodeOf(error)) &&
			failureCount < 3,
	});
}

export function useSaveBudget(month: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (input: BudgetInput) =>
			(await unwrap(api.budgets[":month"].$put({ param: { month }, json: input }))).data,
		// The answer is the month as it now reads: the page shows it at once.
		onSuccess: (budget) => setUpMonth(queryClient, month, budget),
	});
}

/**
 * Shows a month just set up, and stales the others: a later month may now
 * offer to copy this one rather than an older one.
 */
function setUpMonth(queryClient: QueryClient, month: string, budget: BudgetData) {
	void queryClient.invalidateQueries({
		queryKey: queryKeys.transactions.budgets,
		predicate: (query) => query.queryKey[2] !== month,
	});
	queryClient.setQueryData(queryKeys.transactions.budget(month), budget);
}

/**
 * One after the other, a month's category saves and moves: each answer is the
 * whole month, so an answer that overtook a later write would put that
 * write's old amounts back on screen.
 */
const categoriesScope = (month: string) => ({ id: `budget-categories-${month}` });

/** Saves one category's amount; the answer is the whole month, its parent's new amount included. */
export function useSaveCategoryBudget(month: string) {
	const queryClient = useQueryClient();

	return useMutation({
		scope: categoriesScope(month),
		mutationFn: async ({ categoryId, input }: { categoryId: string; input: BudgetCategoryInput }) =>
			(
				await unwrap(
					api.budgets[":month"].categories[":categoryId"].$put({
						param: { month, categoryId },
						json: input,
					}),
				)
			).data,
		onSuccess: (budget) => {
			queryClient.setQueryData(queryKeys.transactions.budget(month), budget);
		},
	});
}

/** Sets a month up from the latest earlier one set up, as Sure's « Copier ». */
export function useCopyBudget(month: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async () =>
			(await unwrap(api.budgets[":month"].copy.$post({ param: { month } }))).data,
		onSuccess: (budget) => setUpMonth(queryClient, month, budget),
		// Set up in another tab, or its source changed: the page reads the month again.
		onError: () =>
			queryClient.invalidateQueries({ queryKey: queryKeys.transactions.budget(month) }),
	});
}

/** Moves money between two categories; the answer is the whole month, both parents included. */
export function useMoveBudget(month: string) {
	const queryClient = useQueryClient();

	return useMutation({
		scope: categoriesScope(month),
		mutationFn: async (input: BudgetMoveInput) =>
			(await unwrap(api.budgets[":month"].move.$post({ param: { month }, json: input }))).data,
		onSuccess: (budget) => {
			queryClient.setQueryData(queryKeys.transactions.budget(month), budget);
		},
		// Changed in another tab: the dialog's figures and destinations read the month again.
		onError: () =>
			queryClient.invalidateQueries({ queryKey: queryKeys.transactions.budget(month) }),
	});
}
