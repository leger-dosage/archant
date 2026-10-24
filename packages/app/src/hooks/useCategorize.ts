import type { InferResponseType } from "hono/client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { CategorizeInput } from "@archant/api/schemas/transactions";

import { useInvalidateBulk } from "@/hooks/useTransactions";
import { api, errorCodeOf, unwrap } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";
import { queryKeys } from "@/lib/query-keys";

type CategorizeStepData = InferResponseType<typeof api.transactions.categorize.$get, 200>["data"];
export type CategorizeGroup = NonNullable<CategorizeStepData["group"]>;
export type CategorizeLine = CategorizeGroup["lines"][number];

/** How many lines « Catégoriser (N) » would go through; read only for an administrator. */
export function useUncategorisedCount(enabled: boolean) {
	return useQuery({
		queryKey: queryKeys.transactions.uncategorisedCount,
		queryFn: async () => (await unwrap(api.transactions.categorize.count.$get())).data.remaining,
		enabled,
	});
}

/**
 * The group at `position` among the uncategorised lines, with how many are
 * left. Read once while shown: the page keeps the group while its lines are
 * categorised. Dropped once left, so going back reads it afresh.
 */
export function useCategorizeStep(position: number, enabled: boolean) {
	return useQuery({
		queryKey: queryKeys.transactions.categorizeStep(position),
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: 0,
		refetchOnWindowFocus: false,
		enabled,
		queryFn: async () =>
			(await unwrap(api.transactions.categorize.$get({ query: { position: String(position) } })))
				.data,
	});
}

/** Sure's `preview_rule`: the uncategorised lines the edited rule text would match. */
export function useCategorizePreview(filter: string | null, type: CategorizeGroup["type"]) {
	return useQuery({
		queryKey: queryKeys.transactions.categorizePreview(filter ?? "", type),
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: 0,
		refetchOnWindowFocus: false,
		queryFn: async () =>
			(
				await unwrap(
					api.transactions.categorize.preview.$get({ query: { filter: filter ?? "", type } }),
				)
			).data.lines,
		enabled: filter !== null,
	});
}

/**
 * Categorises lines, and creates the rule when asked. Refreshes everything a
 * bulk edit does but the wizard itself: the page drops the lines it set and
 * asks for the next group once none is left.
 */
export function useCategorize() {
	const invalidate = useInvalidateBulk({ keep: queryKeys.transactions.categorize });

	return useMutation({
		mutationFn: async (input: CategorizeInput) =>
			(await unwrap(api.transactions.categorize.$post({ json: input }))).data,
		onSuccess: () => invalidate({ balances: false }),
		onError: (error) => showErrorToast(errorCodeOf(error)),
	});
}

/** Asks the wizard again, for the next group once a group is done. */
export function useRefreshCategorize() {
	const queryClient = useQueryClient();

	return () => queryClient.invalidateQueries({ queryKey: queryKeys.transactions.categorize });
}
