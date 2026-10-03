import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, errorCodeOf, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

function attachmentsQuery(transactionId: string, enabled: boolean) {
	return {
		queryKey: queryKeys.transactions.attachments(transactionId),
		queryFn: async () =>
			(await unwrap(api.transactions[":id"].attachments.$get({ param: { id: transactionId } })))
				.data,
		enabled,
		// A transaction deleted elsewhere stays gone: the section says so inline
		// at once rather than after the retries' backoff.
		retry: (failures: number, error: Error) => errorCodeOf(error) !== "NOT_FOUND" && failures < 3,
		meta: { notFoundInline: true },
	};
}

/** A transaction's attachments, oldest first: ten at most, never paginated. */
export function useAttachments(transactionId: string) {
	return useQuery(attachmentsQuery(transactionId, true));
}

/**
 * How many attachments `transactionIds` hold together, read only while
 * `enabled`. `loading` while a list has not arrived yet; a list that failed
 * counts nothing rather than hold its caller forever.
 */
export function useAttachmentCount(transactionIds: readonly string[], enabled: boolean) {
	return useQueries({
		queries: transactionIds.map((id) => attachmentsQuery(id, enabled)),
		combine: (results) => ({
			count: results.reduce((total, result) => total + (result.data?.length ?? 0), 0),
			loading: results.some((result) => result.isPending),
		}),
	});
}

/** Where the browser opens an attachment: its bytes, served inline under a sandbox. */
export function attachmentUrl(transactionId: string, attachmentId: string): string {
	return `/api/transactions/${encodeURIComponent(transactionId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

/** Attaches one file; the section sends several one after the other. */
export function useUploadAttachment(transactionId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (file: File) =>
			(
				await unwrap(
					api.transactions[":id"].attachments.$post({
						param: { id: transactionId },
						form: { file },
					}),
				)
			).data,
		// On failure too: an eleventh file means another tab added some.
		onSettled: () =>
			queryClient.invalidateQueries({
				queryKey: queryKeys.transactions.attachments(transactionId),
			}),
	});
}

export function useDeleteAttachment(transactionId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (attachmentId: string) =>
			(
				await unwrap(
					api.transactions[":id"].attachments[":attachmentId"].$delete({
						param: { id: transactionId, attachmentId },
					}),
				)
			).data,
		// On failure too: a NOT_FOUND means another tab deleted it.
		onSettled: () =>
			queryClient.invalidateQueries({
				queryKey: queryKeys.transactions.attachments(transactionId),
			}),
	});
}
