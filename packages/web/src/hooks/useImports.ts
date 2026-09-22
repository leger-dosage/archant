import type { InferResponseType } from "hono/client";

import { useMutation, useQuery } from "@tanstack/react-query";

import type { ImportPreviewInput } from "@archant/api/schemas/imports";

import { useInvalidateAccount } from "@/hooks/useInvalidateAccount";
import { api, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export type ImportPreviewData = InferResponseType<
	(typeof api.accounts)[":id"]["imports"]["$post"],
	201
>["data"];
export type ImportGroupsData = ImportPreviewData["groups"];
export type ConfirmedImportData = InferResponseType<
	(typeof api.imports)[":id"]["confirm"]["$post"],
	200
>["data"];

export type ImportHistoryPageData = InferResponseType<
	(typeof api.accounts)[":id"]["imports"]["$get"],
	200
>["data"];
export type ImportHistoryItemData = ImportHistoryPageData["items"][number];
export type RevertedImportData = InferResponseType<
	(typeof api.imports)[":id"]["revert"]["$post"],
	200
>["data"];

/** A page of the account's confirmed and reverted imports, latest first. */
export function useAccountImports(accountId: string, page: number) {
	return useQuery({
		queryKey: queryKeys.accounts.imports(accountId, page),
		queryFn: async () =>
			(
				await unwrap(
					api.accounts[":id"].imports.$get({
						param: { id: accountId },
						query: { page: String(page) },
					}),
				)
			).data,
		// As the Soldes table: never another account's rows while the next page loads.
		placeholderData: (previous, previousQuery) =>
			previousQuery?.queryKey[2] === accountId ? previous : undefined,
	});
}

/**
 * Reverts an import. It deletes transactions and a snapshot, so the balance,
 * the chart, both tables, the history and every transaction list go stale.
 */
export function useRevertImport(accountId: string) {
	const invalidate = useInvalidateAccount(accountId);

	return useMutation({
		mutationFn: async (id: string) =>
			(await unwrap(api.imports[":id"].revert.$post({ param: { id } }))).data,
		// On failure too: a 409 means another tab reverted it, and the row must say so.
		onSettled: invalidate,
	});
}

/** Uploads a file and returns its preview; nothing is written yet. */
export function useUploadImport(accountId: string) {
	return useMutation({
		mutationFn: async (file: File) =>
			(
				await unwrap(
					api.accounts[":id"].imports.$post({ param: { id: accountId }, form: { file } }),
				)
			).data,
	});
}

/** Previews a stored import again, with or without moving the opening date. */
export function usePreviewImport() {
	return useMutation({
		mutationFn: async ({ id, input }: { id: string; input: ImportPreviewInput }) =>
			(await unwrap(api.imports[":id"].preview.$post({ param: { id }, json: input }))).data,
	});
}

export function useConfirmImport(accountId: string) {
	const invalidate = useInvalidateAccount(accountId);

	return useMutation({
		mutationFn: async (id: string) =>
			(await unwrap(api.imports[":id"].confirm.$post({ param: { id } }))).data,
		onSuccess: invalidate,
	});
}
