import type { InferResponseType } from "hono/client";

import { useQuery } from "@tanstack/react-query";

import type { BalancePeriod } from "@archant/api/schemas/balances";

import { api, errorCodeOf, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export type BalanceHistoryData = InferResponseType<
	(typeof api.accounts)[":id"]["balances"]["$get"],
	200
>["data"];

export function useBalanceHistory(accountId: string, period: BalancePeriod) {
	return useQuery({
		queryKey: queryKeys.accounts.balances(accountId, period),
		queryFn: async () =>
			(
				await unwrap(
					api.accounts[":id"].balances.$get({ param: { id: accountId }, query: { period } }),
				)
			).data,
		// Keeps the previous period's line while the next one loads, so the chart
		// does not flash a skeleton; never another account's line.
		placeholderData: (previous, previousQuery) =>
			previousQuery?.queryKey[2] === accountId ? previous : undefined,
		// The page already says « Compte introuvable » for an unknown account.
		retry: (failures, error) => errorCodeOf(error) !== "NOT_FOUND" && failures < 3,
		meta: { notFoundInline: true },
	});
}
