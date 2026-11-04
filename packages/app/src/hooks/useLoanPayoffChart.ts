import type { ChartPeriod } from "@/lib/periods";
import type { InferResponseType } from "hono/client";

import { useQuery } from "@tanstack/react-query";

import { api, errorCodeOf, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export type LoanPayoffChartData = NonNullable<
	InferResponseType<(typeof api.accounts)[":id"]["payoff-chart"]["$get"], 200>["data"]
>;

/** A loan's chart over a period, `null` without a schedule; read only for a loan that has one. */
export function useLoanPayoffChart(accountId: string, period: ChartPeriod, enabled: boolean) {
	return useQuery({
		queryKey: queryKeys.accounts.payoffChart(accountId, period),
		queryFn: async () =>
			(
				await unwrap(
					api.accounts[":id"]["payoff-chart"].$get({ param: { id: accountId }, query: period }),
				)
			).data,
		// Keeps the previous period's lines while the next one loads, as the balance chart.
		placeholderData: (previous, previousQuery) =>
			previousQuery?.queryKey[2] === accountId ? previous : undefined,
		// The page already says « Compte introuvable » for an unknown account.
		retry: (failures, error) => errorCodeOf(error) !== "NOT_FOUND" && failures < 3,
		meta: { notFoundInline: true },
		enabled,
	});
}
