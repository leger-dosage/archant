import type { InferResponseType } from "hono/client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { BudgetCategoryInput, BudgetInput } from "@archant/api/schemas/budgets";

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
		onSuccess: (budget) => {
			queryClient.setQueryData(queryKeys.transactions.budget(month), budget);
		},
	});
}

/** Saves one category's amount; the answer is the whole month, its parent's new amount included. */
export function useSaveCategoryBudget(month: string) {
	const queryClient = useQueryClient();

	return useMutation({
		// One after the other: each answer is the whole month, so an answer that
		// overtook a later save would put that save's old amount back on screen.
		scope: { id: `budget-categories-${month}` },
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
