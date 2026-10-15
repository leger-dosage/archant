import type { InferResponseType } from "hono/client";

import { useQuery } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

type AccountOverviewData = NonNullable<
	InferResponseType<(typeof api.accounts)[":id"]["overview"]["$get"], 200>["data"]
>;

export type LoanOverviewData = Extract<AccountOverviewData, { kind: "loan" }>;

export type AssetOverviewData = Extract<AccountOverviewData, { kind: "property" | "vehicle" }>;

/** A loan's, a property's or a vehicle's overview, read only while its tab is open. */
export function useAccountOverview(accountId: string, enabled: boolean) {
	return useQuery({
		queryKey: queryKeys.accounts.overview(accountId),
		queryFn: async () =>
			(await unwrap(api.accounts[":id"].overview.$get({ param: { id: accountId } }))).data,
		enabled,
	});
}
