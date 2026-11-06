import type { InferResponseType } from "hono/client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import type { ReportPeriodType } from "@archant/data/report-periods";

import { api, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export type ReportsPageData = InferResponseType<(typeof api.reports.page)["$get"], 200>["data"];

/** The period the address asks for; absent dates are the type's defaults. */
export type ReportsSearch = {
	periodType: ReportPeriodType;
	startDate?: string | undefined;
	endDate?: string | undefined;
};

/** Without the absent dates, so the query string and the key carry only what is set. */
function reportsQuery(search: ReportsSearch) {
	return {
		periodType: search.periodType,
		...(search.startDate === undefined ? {} : { startDate: search.startDate }),
		...(search.endDate === undefined ? {} : { endDate: search.endDate }),
	};
}

/** « Rapports » of a period, in one read, as the page and its print layout share it. */
export function useReportsPage(search: ReportsSearch) {
	const query = reportsQuery(search);

	return useQuery({
		queryKey: queryKeys.accounts.reportsPage(query),
		queryFn: async () => (await unwrap(api.reports.page.$get({ query }))).data,
		// The previous period stays while the next one loads, so the arrows do not flash a skeleton.
		placeholderData: keepPreviousData,
		// Under `accounts.all`, which a recategorisation or a budget save never
		// invalidates: every visit reads the page again.
		staleTime: 0,
	});
}
