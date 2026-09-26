import type { InferResponseType } from "hono/client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export type RecurringData = InferResponseType<typeof api.recurring.$get, 200>["data"][number];

/** What the user can move a pattern to; `detected` is detection's alone. */
export type RecurringMove = Exclude<RecurringData["status"], "detected">;

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

// A pattern is not a transaction: none of these writes touches the ledger.
function useInvalidateRecurring() {
	const queryClient = useQueryClient();

	return () => queryClient.invalidateQueries({ queryKey: queryKeys.recurring.all });
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
