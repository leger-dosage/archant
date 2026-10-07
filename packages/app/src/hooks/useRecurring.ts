import type { InferResponseType } from "hono/client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
	BillKind,
	BillSort,
	BillStatusFilter,
	DeclareInput,
	EditInput,
} from "@archant/api/schemas/bills";
import type { BillType } from "@archant/data/recurring";

import { api, errorCodeOf, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export type RecurringData = InferResponseType<typeof api.recurring.$get, 200>["data"][number];

export type BillsData = InferResponseType<typeof api.recurring.bills.$get, 200>["data"];

export type BillRowData = BillsData["month"][number];

export type SuggestedPaymentData = BillsData["review"][number];

export type AllBillsData = InferResponseType<typeof api.recurring.bills.all.$get, 200>["data"];

export type BillRecordData = AllBillsData["bills"][number];

export type BillDetailData = InferResponseType<(typeof api.recurring)[":id"]["$get"], 200>["data"];

export type UpcomingData = InferResponseType<
	typeof api.recurring.upcoming.$get,
	200
>["data"][number];

export type BillCandidateData = InferResponseType<
	typeof api.recurring.candidates.$get,
	200
>["data"][number];

/** What a series is called: its typed name, else its merchant's, else its label, as Sure's `display_name`. */
export const recurringName = (item: Pick<RecurringData, "name" | "merchantName" | "label">) =>
	item.name ?? item.merchantName ?? item.label;

/** The URL's search, filters and sort, as `GET /api/recurring/bills/all` reads them. */
export type AllBillsQuery = {
	q?: string | undefined;
	status?: BillStatusFilter | undefined;
	type?: BillType | undefined;
	/** By due date when absent, the default. */
	sort?: Exclude<BillSort, "due"> | undefined;
};

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

/** The bills page: today's sections, totals and review queue. */
export function useBills() {
	return useQuery({
		queryKey: queryKeys.recurring.bills,
		queryFn: async () => (await unwrap(api.recurring.bills.$get())).data,
	});
}

/** « Toutes les factures »: `query` holds the URL's search, filters and sort. */
export function useAllBills(query: AllBillsQuery) {
	return useQuery({
		queryKey: queryKeys.recurring.allBills(query),
		queryFn: async () => (await unwrap(api.recurring.bills.all.$get({ query }))).data,
		placeholderData: keepPreviousData,
	});
}

/** A bill's drawer: the series, what it cost and its price changes. */
export function useBill(id: string) {
	return useQuery({
		queryKey: queryKeys.recurring.bill(id),
		queryFn: async () => (await unwrap(api.recurring[":id"].$get({ param: { id } }))).data,
		// A deleted bill stays deleted, and its drawer says so in place.
		retry: (failureCount, error) =>
			!["NOT_FOUND", "UNAUTHORIZED"].includes(errorCodeOf(error)) && failureCount < 3,
		meta: { notFoundInline: true },
	});
}

/** The « À venir » tab: the active series expected within ten days. */
export function useUpcomingRecurring() {
	return useQuery({
		queryKey: queryKeys.recurring.upcoming,
		queryFn: async () => (await unwrap(api.recurring.upcoming.$get())).data,
	});
}

/** An occurrence's sheet: the occurrence, its payments and its suggestion. */
export function useOccurrence(id: string) {
	return useQuery({
		queryKey: queryKeys.recurring.occurrence(id),
		queryFn: async () =>
			(await unwrap(api.recurring.occurrences[":id"].$get({ param: { id } }))).data,
	});
}

/** « Ajouter un paiement »'s transactions; only an administrator's sheet mounts what reads them. */
export function usePaymentCandidates(id: string) {
	return useQuery({
		queryKey: queryKeys.recurring.paymentCandidates(id),
		queryFn: async () =>
			(await unwrap(api.recurring.occurrences[":id"].candidates.$get({ param: { id } }))).data,
	});
}

/** « Appliquer »: the suggested payment becomes one the owner confirmed. */
export function useConfirmPayment() {
	const invalidate = useInvalidateRecurring();

	return useMutation({
		mutationFn: async (id: string) =>
			(await unwrap(api.recurring.payments[":id"].confirm.$post({ param: { id } }))).data,
		onSuccess: invalidate,
	});
}

/** « Pas cette facture »: the transaction is never suggested for that series again. */
export function useRejectPayment() {
	const invalidate = useInvalidateRecurring();

	return useMutation({
		mutationFn: async (id: string) =>
			(await unwrap(api.recurring.payments[":id"].reject.$post({ param: { id } }))).data,
		onSuccess: invalidate,
	});
}

/** Removes a payment from its occurrence. */
export function useRemovePayment() {
	const invalidate = useInvalidateRecurring();

	return useMutation({
		mutationFn: async (id: string) =>
			(await unwrap(api.recurring.payments[":id"].$delete({ param: { id } }))).data,
		onSuccess: invalidate,
	});
}

/** « Marquer comme payée », at the date given. */
export function useMarkPaid(id: string) {
	const invalidate = useInvalidateRecurring();

	return useMutation({
		mutationFn: async (paidOn: string) =>
			(
				await unwrap(
					api.recurring.occurrences[":id"].paid.$post({ param: { id }, json: { paidOn } }),
				)
			).data,
		onSuccess: invalidate,
	});
}

/** « Ajouter un paiement »: a transaction, or an amount and a date. */
export function useAddPayment(id: string) {
	const invalidate = useInvalidateRecurring();

	return useMutation({
		mutationFn: async (json: { entryId?: string; amount?: string; paidOn?: string }) =>
			(await unwrap(api.recurring.occurrences[":id"].payments.$post({ param: { id }, json }))).data,
		onSuccess: invalidate,
	});
}

/** « Ignorer cette échéance » and « Rouvrir ». */
export function useSetOccurrenceClosed(id: string) {
	const invalidate = useInvalidateRecurring();

	return useMutation({
		mutationFn: async (action: "skip" | "reopen") =>
			(await unwrap(api.recurring.occurrences[":id"][action].$post({ param: { id } }))).data,
		onSuccess: invalidate,
	});
}

/** « Reporter » and « Modifier le montant ». */
export function useEditOccurrence(id: string) {
	const invalidate = useInvalidateRecurring();

	return useMutation({
		mutationFn: async (
			patch: { snoozedUntil: string | null } | { expectedAmount: string | null },
		) =>
			(await unwrap(api.recurring.occurrences[":id"].$patch({ param: { id }, json: patch }))).data,
		onSuccess: invalidate,
	});
}
