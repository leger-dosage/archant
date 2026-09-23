import type { InferResponseType } from "hono/client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { CreateCategoryInput, UpdateCategoryInput } from "@archant/api/schemas/categories";

import { api, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export type CategoryData = InferResponseType<typeof api.categories.$get, 200>["data"][number];

export function useCategories() {
	return useQuery({
		queryKey: queryKeys.categories.all,
		queryFn: async () => (await unwrap(api.categories.$get())).data,
	});
}

export function useCreateCategory() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (input: CreateCategoryInput) =>
			(await unwrap(api.categories.$post({ json: input }))).data,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.categories.all }),
	});
}

export function useUpdateCategory() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({ id, patch }: { id: string; patch: UpdateCategoryInput }) =>
			(await unwrap(api.categories[":id"].$patch({ param: { id }, json: patch }))).data,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.categories.all }),
	});
}

/**
 * Invalidates the transaction lists too: a delete and a merge move
 * transactions to another category, or out of any.
 */
function useInvalidateAfterMove() {
	const queryClient = useQueryClient();

	return () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: queryKeys.categories.all }),
			queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all }),
		]);
}

/** Deletes a category; without `replacementId`, its transactions become uncategorised. */
export function useDeleteCategory() {
	const invalidate = useInvalidateAfterMove();

	return useMutation({
		mutationFn: async ({ id, replacementId }: { id: string; replacementId: string | null }) =>
			(
				await unwrap(
					api.categories[":id"].$delete({
						param: { id },
						query: replacementId === null ? {} : { replacementId },
					}),
				)
			).data,
		onSuccess: invalidate,
	});
}

export function useMergeCategory() {
	const invalidate = useInvalidateAfterMove();

	return useMutation({
		mutationFn: async ({ id, targetId }: { id: string; targetId: string }) =>
			(await unwrap(api.categories[":id"].merge.$post({ param: { id }, json: { targetId } }))).data,
		onSuccess: invalidate,
	});
}
