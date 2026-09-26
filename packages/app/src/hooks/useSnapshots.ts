import type { InferResponseType } from "hono/client";

import { useMutation, useQuery } from "@tanstack/react-query";

import type { SnapshotInput, SnapshotPatchInput } from "@archant/api/schemas/snapshots";

import { useInvalidateAccount } from "@/hooks/useInvalidateAccount";
import { api, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export type SnapshotPageData = InferResponseType<
	(typeof api.accounts)[":id"]["snapshots"]["$get"],
	200
>["data"];
export type SnapshotData = SnapshotPageData["items"][number];

export function useAccountSnapshots(accountId: string, page: number) {
	return useQuery({
		queryKey: queryKeys.accounts.snapshots(accountId, page),
		queryFn: async () =>
			(
				await unwrap(
					api.accounts[":id"].snapshots.$get({
						param: { id: accountId },
						query: { page: String(page) },
					}),
				)
			).data,
		// Keeps the current page on screen while the next one loads, but never
		// another account's rows: opening one would edit the wrong account.
		placeholderData: (previous, previousQuery) =>
			previousQuery?.queryKey[2] === accountId ? previous : undefined,
	});
}

export function useCreateSnapshot(accountId: string) {
	const invalidate = useInvalidateAccount(accountId);

	return useMutation({
		mutationFn: async (input: SnapshotInput) =>
			(await unwrap(api.accounts[":id"].snapshots.$post({ param: { id: accountId }, json: input })))
				.data,
		onSuccess: invalidate,
	});
}

export function useUpdateSnapshot(accountId: string) {
	const invalidate = useInvalidateAccount(accountId);

	return useMutation({
		mutationFn: async ({ id, input }: { id: string; input: SnapshotPatchInput }) =>
			(await unwrap(api.snapshots[":id"].$patch({ param: { id }, json: input }))).data,
		onSuccess: invalidate,
	});
}

export function useDeleteSnapshot(accountId: string) {
	const invalidate = useInvalidateAccount(accountId);

	return useMutation({
		mutationFn: async (id: string) =>
			(await unwrap(api.snapshots[":id"].$delete({ param: { id } }))).data,
		onSuccess: invalidate,
	});
}
