import type { ChartPeriod } from "@/lib/periods";
import type { InferResponseType } from "hono/client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export type DashboardCashFlowData = InferResponseType<
	(typeof api.reports)["cash-flow"]["$get"],
	200
>["data"];

/**
 * The net cash flow over the dashboard's period, read once for the Sankey
 * and the donut. `enabled` is false while the saved period loads.
 */
export function useDashboardCashFlow(period: ChartPeriod, enabled = true) {
	return useQuery({
		queryKey: queryKeys.transactions.cashFlow(period),
		queryFn: async () => (await unwrap(api.reports["cash-flow"].$get({ query: period }))).data,
		// Keeps the previous period's flows while the next one loads, so the
		// cards do not flash a skeleton on each pick.
		placeholderData: keepPreviousData,
		enabled,
	});
}
