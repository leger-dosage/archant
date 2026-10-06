import type { InferResponseType } from "hono/client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { BillKind, DeclareInput, EditInput } from "@archant/api/schemas/bills";

import { api, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export type RecurringData = InferResponseType<typeof api.recurring.$get, 200>["data"][number];

export type BillCandidateData = InferResponseType<
	typeof api.recurring.candidates.$get,
	200
>["data"][number];

/** What a series is called: its typed name, else its merchant's, else its label, as Sure's `display_name`. */
export const recurringName = (item: Pick<RecurringData, "name" | "merchantName" | "label">) =>
	item.name ?? item.merchantName ?? item.label;

/** What the user can move a pattern to; `suggested` is detection's alone. */
export type RecurringMove = Exclude<RecurringData["status"], "suggested">;

export function useRecurring() {
	return useQuery({
		queryKey: queryKeys.recurring.all,
		queryFn: async () => (await unwrap(api.recurring.$get())).data,
	});
}

/** The series a transaction belongs to, `null` without one. */
export function useRecurringOfEntry(entryId: string) {
	return useQuery({
		queryKey: queryKeys.recurring.ofEntry(entryId),
		queryFn: async () =>
			(await unwrap(api.recurring["by-entry"][":entryId"].$get({ param: { entryId } }))).data,
	});
}

// None of these writes touches the ledger, but a list row shows « Récurrent »
// from the series its account and key match, so the lists follow a change.
function useInvalidateRecurring() {
	const queryClient = useQueryClient();

	return () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: queryKeys.recurring.all }),
			queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all }),
		]);
}

export function useDetectRecurring() {
	const invalidate = useInvalidateRecurring();

	return useMutation({
		mutationFn: async () => (await unwrap(api.recurring.detect.$post())).data,
		onSuccess: invalidate,
	});
}

export function useSetRecurringStatus() {
	const invalidate = useInvalidateRecurring();

	return useMutation({
		mutationFn: async ({ id, status }: { id: string; status: RecurringMove }) =>
			(await unwrap(api.recurring[":id"].$patch({ param: { id }, json: { status } }))).data,
		onSuccess: invalidate,
	});
}

export function useAddRecurring() {
	const invalidate = useInvalidateRecurring();

	return useMutation({
		mutationFn: async (entryId: string) =>
			(await unwrap(api.recurring.$post({ json: { entryId } }))).data,
		onSuccess: invalidate,
	});
}

/** « Supprimer »: deletes a manual series, ends a detected one. */
export function useDeleteRecurring() {
	const invalidate = useInvalidateRecurring();

	return useMutation({
		mutationFn: async (id: string) =>
			(await unwrap(api.recurring[":id"].$delete({ param: { id } }))).data,
		onSuccess: invalidate,
	});
}

/** « Nettoyer les obsolètes »: marks stale series inactive. */
export function useCleanupRecurring() {
	const invalidate = useInvalidateRecurring();

	return useMutation({
		mutationFn: async () => (await unwrap(api.recurring.cleanup.$post())).data,
		onSuccess: invalidate,
	});
}

/** The declare dialog's starting points, fetched when it opens. */
export function useBillCandidates(kind: BillKind, enabled: boolean) {
	return useQuery({
		queryKey: queryKeys.recurring.candidates(kind),
		queryFn: async () => (await unwrap(api.recurring.candidates.$get({ query: { kind } }))).data,
		enabled,
	});
}

/** « Ajouter une facture » and « Ajouter un revenu ». */
export function useDeclareBill() {
	const invalidate = useInvalidateRecurring();

	return useMutation({
		mutationFn: async (input: DeclareInput) =>
			(await unwrap(api.recurring.declare.$post({ json: input }))).data,
		onSuccess: invalidate,
	});
}

/** « Modifier »: the edit dialog's fields. */
export function useEditBill() {
	const invalidate = useInvalidateRecurring();

	return useMutation({
		mutationFn: async ({ id, input }: { id: string; input: EditInput }) =>
			(await unwrap(api.recurring[":id"].$patch({ param: { id }, json: input }))).data,
		onSuccess: invalidate,
	});
}
