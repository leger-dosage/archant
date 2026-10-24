import type { InferResponseType } from "hono/client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { TagInput } from "@archant/api/schemas/tags";

import { api, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export type TagData = InferResponseType<typeof api.tags.$get, 200>["data"][number];

export function useTags() {
	return useQuery({
		queryKey: queryKeys.tags.all,
		queryFn: async () => (await unwrap(api.tags.$get())).data,
	});
}

export function useCreateTag() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (input: TagInput) => (await unwrap(api.tags.$post({ json: input }))).data,
		// Added at once, so a row given the new tag shows its name before the
		// list comes back.
		onSuccess: (tag) => {
			queryClient.setQueryData<TagData[]>(queryKeys.tags.all, (list) =>
				list === undefined ? list : [...list, tag],
			);

			return queryClient.invalidateQueries({ queryKey: queryKeys.tags.all });
		},
	});
}

/** Renames a tag, and changes its colour. */
export function useUpdateTag() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({ id, ...json }: TagInput & { id: string }) =>
			(await unwrap(api.tags[":id"].$patch({ param: { id }, json }))).data,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.tags.all }),
	});
}

/** A delete and a delete all take tags off transactions, so the lists are refetched too. */
function useInvalidateAfterRemoval() {
	const queryClient = useQueryClient();

	return () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: queryKeys.tags.all }),
			queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all }),
		]);
}

/** Deletes a tag; its transactions lose it, or carry `replacementId` instead. */
export function useDeleteTag() {
	const invalidate = useInvalidateAfterRemoval();

	return useMutation({
		mutationFn: async ({ id, replacementId }: { id: string; replacementId: string | null }) =>
			(
				await unwrap(
					api.tags[":id"].$delete({
						param: { id },
						query: replacementId === null ? {} : { replacementId },
					}),
				)
			).data,
		onSuccess: invalidate,
	});
}

/** Sure's `destroy_all`: every tag goes, off every transaction. */
export function useDeleteAllTags() {
	const invalidate = useInvalidateAfterRemoval();

	return useMutation({
		mutationFn: async () => (await unwrap(api.tags.$delete())).data,
		onSuccess: invalidate,
	});
}
