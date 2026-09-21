import type { InferResponseType } from "hono/client";

import { useQuery } from "@tanstack/react-query";

import { api, errorCodeOf, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export type AccountDetailData = InferResponseType<
	(typeof api.accounts)[":id"]["$get"],
	200
>["data"];

export function useAccount(id: string) {
	return useQuery({
		queryKey: queryKeys.accounts.detail(id),
		queryFn: async () => (await unwrap(api.accounts[":id"].$get({ param: { id } }))).data,
		// An unknown account will not appear by asking again; the page says so.
		retry: (failures, error) => errorCodeOf(error) !== "NOT_FOUND" && failures < 3,
		meta: { notFoundInline: true },
	});
}
