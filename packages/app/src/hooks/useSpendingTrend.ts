import type { InferResponseType } from "hono/client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export type SpendingTrendData = InferResponseType<
	(typeof api.reports)["spending-trend"]["$get"],
	200
>["data"];

/** « Dépenses » of a month against the previous one; `undefined` asks for this month. */
export function useSpendingTrend(month: string | undefined) {
	return useQuery({
		queryKey: queryKeys.transactions.spendingTrend(month),
		queryFn: async () =>
			(
				await unwrap(
					api.reports["spending-trend"].$get({
						query: month === undefined ? {} : { month },
					}),
				)
			).data,
		placeholderData: keepPreviousData,
	});
}
