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

export function useRenameTag() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({ id, name }: { id: string; name: string }) =>
			(await unwrap(api.tags[":id"].$patch({ param: { id }, json: { name } }))).data,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.tags.all }),
	});
}

/** Deletes a tag; its transactions lose it, so the lists are refetched too. */
export function useDeleteTag() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (id: string) =>
			(await unwrap(api.tags[":id"].$delete({ param: { id } }))).data,
		onSuccess: () =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: queryKeys.tags.all }),
				queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all }),
			]),
	});
}
