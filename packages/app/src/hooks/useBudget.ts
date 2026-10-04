import type { InferResponseType } from "hono/client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { BudgetInput } from "@archant/api/schemas/budgets";

import { api, errorCodeOf, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export type BudgetData = InferResponseType<(typeof api.budgets)[":month"]["$get"], 200>["data"];

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
