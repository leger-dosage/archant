import type { InferResponseType } from "hono/client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { TradeInput, TradePatchInput } from "@archant/api/schemas/trades";

import { useInvalidateAccount } from "@/hooks/useInvalidateAccount";
import { api, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

type TradePageData = InferResponseType<(typeof api.accounts)[":id"]["trades"]["$get"], 200>["data"];
export type TradeData = TradePageData["items"][number];

export function useAccountTrades(accountId: string, page: number) {
	return useQuery({
		queryKey: queryKeys.accounts.trades(accountId, page),
		queryFn: async () =>
			(
				await unwrap(
					api.accounts[":id"].trades.$get({
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

/** Refreshes the account and, since a new trade may have created one, the securities search. */
function useInvalidateTrades(accountId: string) {
	const queryClient = useQueryClient();
	const invalidateAccount = useInvalidateAccount(accountId);

	return () =>
		Promise.all([
			invalidateAccount(),
			queryClient.invalidateQueries({ queryKey: queryKeys.securities.all }),
		]);
}

export function useCreateTrade(accountId: string) {
	const invalidate = useInvalidateTrades(accountId);

	return useMutation({
		mutationFn: async (input: TradeInput) =>
			(await unwrap(api.accounts[":id"].trades.$post({ param: { id: accountId }, json: input })))
				.data,
		onSuccess: invalidate,
	});
}

export function useUpdateTrade(accountId: string) {
	const invalidate = useInvalidateTrades(accountId);

	return useMutation({
		mutationFn: async ({ id, input }: { id: string; input: TradePatchInput }) =>
			(await unwrap(api.trades[":id"].$patch({ param: { id }, json: input }))).data,
		onSuccess: invalidate,
	});
}

export function useDeleteTrade(accountId: string) {
	const invalidate = useInvalidateTrades(accountId);

	return useMutation({
		mutationFn: async (id: string) =>
			(await unwrap(api.trades[":id"].$delete({ param: { id } }))).data,
		onSuccess: invalidate,
	});
}
