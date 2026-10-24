import type { InferResponseType } from "hono/client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { MerchantInput } from "@archant/api/schemas/merchants";

import { api, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export type MerchantData = InferResponseType<typeof api.merchants.$get, 200>["data"][number];

export function useMerchants() {
	return useQuery({
		queryKey: queryKeys.merchants.all,
		queryFn: async () => (await unwrap(api.merchants.$get())).data,
	});
}

export function useCreateMerchant() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (input: MerchantInput) =>
			(await unwrap(api.merchants.$post({ json: input }))).data,
		// Added at once, so a row given the new merchant shows its name before
		// the list comes back.
		onSuccess: (merchant) => {
			queryClient.setQueryData<MerchantData[]>(queryKeys.merchants.all, (list) =>
				list === undefined ? list : [...list, merchant],
			);

			return queryClient.invalidateQueries({ queryKey: queryKeys.merchants.all });
		},
	});
}

/** Renames a merchant, and changes its colour or website. */
export function useUpdateMerchant() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({ id, ...json }: MerchantInput & { id: string }) =>
			(await unwrap(api.merchants[":id"].$patch({ param: { id }, json }))).data,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.merchants.all }),
	});
}

/**
 * Invalidates the transaction lists too: a delete and a merge move
 * transactions to another merchant, or out of any.
 */
function useInvalidateAfterMove() {
	const queryClient = useQueryClient();

	return () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: queryKeys.merchants.all }),
			queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all }),
		]);
}

/** Deletes a merchant; its transactions lose it. */
export function useDeleteMerchant() {
	const invalidate = useInvalidateAfterMove();

	return useMutation({
		mutationFn: async (id: string) =>
			(await unwrap(api.merchants[":id"].$delete({ param: { id } }))).data,
		onSuccess: invalidate,
	});
}

/** Sure's `perform_merge`: several sources into one target. */
export function useMergeMerchants() {
	const invalidate = useInvalidateAfterMove();

	return useMutation({
		mutationFn: async (json: { targetId: string; sourceIds: string[] }) =>
			(await unwrap(api.merchants.merge.$post({ json }))).data,
		onSuccess: invalidate,
	});
}
