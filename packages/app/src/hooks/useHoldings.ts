import type { InferResponseType } from "hono/client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { CostBasisInput } from "@archant/api/schemas/holdings";
import type { TypedPriceInput } from "@archant/api/schemas/prices";

import { api, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export type HoldingsData = InferResponseType<
	(typeof api.accounts)[":id"]["holdings"]["$get"],
	200
>["data"];
export type PositionData = HoldingsData["positions"][number];

/**
 * The account's positions today and its cash, as « Positions » lists them;
 * read only for an investment account, the one kind that holds securities.
 */
export function useAccountHoldings(accountId: string, enabled: boolean) {
	return useQuery({
		queryKey: queryKeys.accounts.holdings(accountId),
		queryFn: async () =>
			(await unwrap(api.accounts[":id"].holdings.$get({ param: { id: accountId } }))).data,
		enabled,
	});
}

/** As many as one page holds: a position bought monthly for over sixteen years. */
const POSITION_TRADES = 200;

/**
 * A position's trades, most recent first: its sheet shows up to
 * `POSITION_TRADES` of them and says how many older ones « Ordres » lists.
 */
export function usePositionTrades(accountId: string, securityId: string, enabled: boolean) {
	return useQuery({
		queryKey: queryKeys.accounts.positionTrades(accountId, securityId),
		queryFn: async () =>
			(
				await unwrap(
					api.accounts[":id"].trades.$get({
						param: { id: accountId },
						query: { securityId, pageSize: String(POSITION_TRADES) },
					}),
				)
			).data,
		enabled,
	});
}

/** A lock moves no balance: only the positions change. */
function useInvalidateHoldings(accountId: string) {
	const queryClient = useQueryClient();

	return () => queryClient.invalidateQueries({ queryKey: queryKeys.accounts.holdings(accountId) });
}

export function useSetCostBasis(accountId: string, securityId: string) {
	const invalidate = useInvalidateHoldings(accountId);

	return useMutation({
		mutationFn: async (input: CostBasisInput) =>
			(
				await unwrap(
					api.accounts[":id"].holdings[":securityId"]["cost-basis"].$put({
						param: { id: accountId, securityId },
						json: input,
					}),
				)
			).data,
		onSuccess: invalidate,
	});
}

export function useUnlockCostBasis(accountId: string, securityId: string) {
	const invalidate = useInvalidateHoldings(accountId);

	return useMutation({
		mutationFn: async () =>
			(
				await unwrap(
					api.accounts[":id"].holdings[":securityId"]["cost-basis"].$delete({
						param: { id: accountId, securityId },
					}),
				)
			).data,
		onSuccess: invalidate,
	});
}

/**
 * « Saisir un cours ». Every account holding the security is valued again,
 * so every account query goes stale, the net worth and goals among them.
 */
export function useTypePrice(securityId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (input: TypedPriceInput) =>
			(await unwrap(api.securities[":id"].prices.$post({ param: { id: securityId }, json: input })))
				.data,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.accounts.all }),
	});
}
