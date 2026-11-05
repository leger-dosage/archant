import type { ChartPeriod } from "@/lib/periods";
import type { InferResponseType } from "hono/client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export type InvestmentSummaryData = InferResponseType<
	(typeof api.reports)["investment-summary"]["$get"],
	200
>["data"];

/**
 * Sure's investment summary over the dashboard's period. `enabled` is false
 * while the saved period loads.
 */
export function useInvestmentSummary(period: ChartPeriod, enabled = true) {
	return useQuery({
		queryKey: queryKeys.accounts.investmentSummary(period),
		queryFn: async () =>
			(await unwrap(api.reports["investment-summary"].$get({ query: period }))).data,
		// Keeps the previous period's activity while the next one loads, so the
		// card does not flash away on each pick.
		placeholderData: keepPreviousData,
		enabled,
	});
}
