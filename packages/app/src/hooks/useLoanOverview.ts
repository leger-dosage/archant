import type { InferResponseType } from "hono/client";

import { useQuery } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export type LoanOverviewData = NonNullable<
	InferResponseType<(typeof api.accounts)[":id"]["overview"]["$get"], 200>["data"]
>;

/** A loan's overview, read only while its tab is open. */
export function useLoanOverview(accountId: string, enabled: boolean) {
	return useQuery({
		queryKey: queryKeys.accounts.overview(accountId),
		queryFn: async () =>
			(await unwrap(api.accounts[":id"].overview.$get({ param: { id: accountId } }))).data,
		enabled,
	});
}
