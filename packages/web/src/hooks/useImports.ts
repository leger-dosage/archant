import type { InferResponseType } from "hono/client";

import { useMutation } from "@tanstack/react-query";

import type { ImportPreviewInput } from "@archant/api/schemas/imports";

import { useInvalidateAccount } from "@/hooks/useInvalidateAccount";
import { api, unwrap } from "@/lib/api";

export type ImportPreviewData = InferResponseType<
	(typeof api.accounts)[":id"]["imports"]["$post"],
	201
>["data"];
export type ImportGroupsData = ImportPreviewData["groups"];
export type ConfirmedImportData = InferResponseType<
	(typeof api.imports)[":id"]["confirm"]["$post"],
	200
>["data"];

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
