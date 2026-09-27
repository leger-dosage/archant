import { useQuery } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useVersion() {
	return useQuery({
		queryKey: queryKeys.version,
		queryFn: async () => (await unwrap(api.version.$get())).data,
		// Only a restart changes it; an open tab shows the old version until
		// the page is reloaded.
		staleTime: Number.POSITIVE_INFINITY,
		// A detail: a failure is not worth retrying, nor a toast.
		retry: false,
		meta: { optional: true },
	});
}
