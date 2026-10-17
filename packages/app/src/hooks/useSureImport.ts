import type { InferResponseType } from "hono/client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";

export type SurePreflightData = InferResponseType<
	(typeof api)["sure-imports"]["preflight"]["$post"],
	200
>["data"];

/** Reads an archive and answers Sure's counts, errors and warnings; nothing is written. */
export function useSurePreflight() {
	return useMutation({
		mutationFn: async (file: File) =>
			(await unwrap(api["sure-imports"].preflight.$post({ form: { file } }))).data,
	});
}

/**
 * Imports the archive the preflight read, sent again: nothing is stored in
 * between. Every account, list and report may change, so every query goes
 * stale.
 */
export function useStartSureImport() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (file: File) =>
			(await unwrap(api["sure-imports"].$post({ form: { file } }))).data,
		onSuccess: () => queryClient.invalidateQueries(),
	});
}
