import type { InferResponseType } from "hono/client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export type MoneyFlowData = InferResponseType<
	(typeof api.reports)["money-flow"]["$get"],
	200
>["data"];

/** « Entrées / sorties d'argent »: `undefined` asks for this month, or for every account. */
export function useMoneyFlow(month: string | undefined, accountIds: readonly string[] | undefined) {
	return useQuery({
		queryKey: queryKeys.transactions.moneyFlow(month, accountIds),
		queryFn: async () =>
			(
				await unwrap(
					api.reports["money-flow"].$get({
						query: {
							...(month === undefined ? {} : { month }),
							...(accountIds === undefined ? {} : { accountIds: [...accountIds] }),
						},
					}),
				)
			).data,
		placeholderData: keepPreviousData,
	});
}
