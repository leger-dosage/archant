import type { InferResponseType } from "hono/client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { RuleInput } from "@archant/api/schemas/rules";

import { api, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export type RuleData = InferResponseType<typeof api.rules.$get, 200>["data"][number];

export function useRules() {
	return useQuery({
		queryKey: queryKeys.rules.all,
		queryFn: async () => (await unwrap(api.rules.$get())).data,
	});
}

// A rule changes no transaction on save: only later ones, so only the list
// of rules goes stale.
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
