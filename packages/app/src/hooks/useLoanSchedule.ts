import type { InferResponseType } from "hono/client";

import { useQuery } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export type LoanScheduleData = NonNullable<
	InferResponseType<(typeof api.accounts)[":id"]["schedule"]["$get"], 200>["data"]
>;

/**
 * A loan's amortisation schedule, `null` when it has none; read only for a
 * loan, the one kind that can have one.
 */
export function useLoanSchedule(accountId: string, enabled: boolean) {
	return useQuery({
		queryKey: queryKeys.accounts.schedule(accountId),
		queryFn: async () =>
			(await unwrap(api.accounts[":id"].schedule.$get({ param: { id: accountId } }))).data,
		enabled,
	});
}
