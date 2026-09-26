import type { InferResponseType } from "hono/client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export type CashFlowData = InferResponseType<
	(typeof api.reports)["cash-flow"]["$get"],
	200
>["data"];

export type CashFlowLine = CashFlowData["lines"]["income"][number];

export function useCashFlow(month: string) {
	return useQuery({
		queryKey: queryKeys.transactions.cashFlow(month),
		queryFn: async () => (await unwrap(api.reports["cash-flow"].$get({ query: { month } }))).data,
		// Keeps the previous month's rows while the next one loads, so the card
		// does not flash a skeleton on each arrow.
		placeholderData: keepPreviousData,
	});
}
