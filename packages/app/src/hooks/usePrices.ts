import type { InferResponseType } from "hono/client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export type PriceStatusData = InferResponseType<typeof api.prices.$get, 200>["data"];

/** How often the state is read again while a run holds the lease. */
const UPDATE_POLL_MS = 2000;

/**
 * Whether prices are fetched, from which host, and the last run. The first
 * visit of the day fetches after the server has answered, so while the state
 * says a run is on it is read every two seconds.
 */
export function usePrices() {
	return useQuery({
		queryKey: queryKeys.prices.status,
		queryFn: async () => (await unwrap(api.prices.$get())).data,
		refetchInterval: (query) => (query.state.data?.updating === true ? UPDATE_POLL_MS : false),
	});
}

/** Turns fetching on or off; the answer is the new state. */
export function useSetPricesEnabled() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (enabled: boolean) =>
			(await unwrap(api.prices.settings.$put({ json: { enabled } }))).data,
		onSuccess: (status) => {
			queryClient.setQueryData(queryKeys.prices.status, status);
		},
	});
}

/** « Mettre à jour les cours »: answers once the run is over, with the new state. */
export function useUpdatePrices() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async () => (await unwrap(api.prices.update.$post())).data,
		onSuccess: (status) => {
			queryClient.setQueryData(queryKeys.prices.status, status);
		},
		// A refusal says another run holds the lease: reading the state again
		// shows it, and polls until it ends.
		onError: async () => {
			await queryClient.invalidateQueries({ queryKey: queryKeys.prices.status });
		},
	});
}
