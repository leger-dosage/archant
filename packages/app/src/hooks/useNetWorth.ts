import type { ChartPeriod } from "@/lib/periods";
import type { InferResponseType } from "hono/client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export type NetWorthData = InferResponseType<
	(typeof api.reports)["net-worth"]["$get"],
	200
>["data"];

/** `enabled` is false while the saved period, which the address does not override, loads. */
export function useNetWorth(period: ChartPeriod, enabled = true) {
	return useQuery({
		queryKey: queryKeys.accounts.netWorth(period),
		queryFn: async () => (await unwrap(api.reports["net-worth"].$get({ query: period }))).data,
		// Keeps the previous period's line and totals while the next one loads,
		// so the card does not flash a skeleton.
		placeholderData: keepPreviousData,
		enabled,
	});
}
