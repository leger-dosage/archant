import type { InferResponseType } from "hono/client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { RuleInput } from "@archant/api/schemas/rules";

import { useInvalidateBulk } from "@/hooks/useTransactions";
import { api, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export type RuleData = InferResponseType<typeof api.rules.$get, 200>["data"][number];

export type RuleRunData = InferResponseType<
	typeof api.rules.runs.$get,
	200
>["data"]["items"][number];

export function useRules() {
	return useQuery({
		queryKey: queryKeys.rules.all,
		queryFn: async () => (await unwrap(api.rules.$get())).data,
	});
}

// Saving a rule changes no transaction: only later ones, or an application
// the user confirms after it, so only the rules go stale.
function useInvalidateRules() {
	const queryClient = useQueryClient();

	return () => queryClient.invalidateQueries({ queryKey: queryKeys.rules.all });
}

export function useCreateRule() {
	const invalidate = useInvalidateRules();

	return useMutation({
		mutationFn: async (input: RuleInput) => (await unwrap(api.rules.$post({ json: input }))).data,
		onSuccess: invalidate,
	});
}

export function useUpdateRule() {
	const invalidate = useInvalidateRules();

	return useMutation({
		mutationFn: async ({ id, input }: { id: string; input: RuleInput }) =>
			(await unwrap(api.rules[":id"].$put({ param: { id }, json: input }))).data,
		onSuccess: invalidate,
	});
}

export function useSetRuleEnabled() {
	const invalidate = useInvalidateRules();

	return useMutation({
		mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) =>
			(await unwrap(api.rules[":id"].$patch({ param: { id }, json: { enabled } }))).data,
		onSuccess: invalidate,
	});
}

export function useDeleteRule() {
	const invalidate = useInvalidateRules();

	return useMutation({
		mutationFn: async (id: string) =>
			(await unwrap(api.rules[":id"].$delete({ param: { id } }))).data,
		onSuccess: invalidate,
	});
}

/**
 * Returns a function that reads how many transactions applying the rule
 * `ruleId`, or every enabled rule for `null`, would change. Read afresh on
 * each call: the count is what the confirmation states.
 */
export function useFetchRulePreview() {
	const queryClient = useQueryClient();

	return (ruleId: string | null) =>
		queryClient.fetchQuery({
			queryKey: queryKeys.rules.preview(ruleId),
			queryFn: async () =>
				(
					await unwrap(
						ruleId === null
							? api.rules.preview.$get()
							: api.rules[":id"].preview.$get({ param: { id: ruleId } }),
					)
				).data,
			staleTime: 0,
		});
}

/**
 * Applies the rule `ruleId`, or every enabled rule for `null`, to existing
 * transactions. Every list, count and balance a bulk edit refreshes goes
 * stale, and the rules with their runs.
 */
export function useApplyRules() {
	const queryClient = useQueryClient();
	const invalidateBulk = useInvalidateBulk();

	return useMutation({
		mutationFn: async (ruleId: string | null) =>
			(
				await unwrap(
					ruleId === null
						? api.rules.apply.$post()
						: api.rules[":id"].apply.$post({ param: { id: ruleId } }),
				)
			).data,
		onSuccess: () =>
			Promise.all([
				invalidateBulk({ balances: true }),
				queryClient.invalidateQueries({ queryKey: queryKeys.rules.all }),
			]),
	});
}

/** A page of the recorded applications, the latest first. */
export function useRuleRuns(page: number) {
	return useQuery({
		queryKey: queryKeys.rules.runs(page),
		queryFn: async () =>
			(await unwrap(api.rules.runs.$get({ query: { page: String(page) } }))).data,
		placeholderData: (previous) => previous,
	});
}
