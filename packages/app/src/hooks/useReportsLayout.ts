import type { InferResponseType } from "hono/client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ReportsLayoutInput } from "@archant/api/schemas/reports";
import { mergeReportsLayout, resolveReportsLayout } from "@archant/data/reports-layout";

import { api, unwrap } from "@/lib/api";
import { showFailureToast } from "@/lib/error-toast";
import { queryKeys } from "@/lib/query-keys";

export type ReportsLayoutData = InferResponseType<(typeof api.reports.layout)["$get"], 200>["data"];

/** The signed-in user's section order and collapsed sections. Off for a viewer, who sees the default. */
export function useReportsLayout({ enabled }: { enabled: boolean }) {
	return useQuery({
		queryKey: queryKeys.reportsLayout,
		enabled,
		queryFn: async () => (await unwrap(api.reports.layout.$get())).data,
	});
}

/**
 * Saves one change to the reports page, applied in the cache at once by the
 * code the server merges with. A failure puts the layout back and says so.
 */
export function useUpdateReportsLayout() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationKey: queryKeys.reportsLayout,
		// One save after the other, as the dashboard's: an older answer landing
		// after a newer change would put the older layout back.
		scope: { id: "reports-layout" },
		mutationFn: async (change: ReportsLayoutInput) =>
			(await unwrap(api.reports.layout.$patch({ json: change }))).data,
		onMutate: async (change) => {
			await queryClient.cancelQueries({ queryKey: queryKeys.reportsLayout });
			const previous = queryClient.getQueryData<ReportsLayoutData>(queryKeys.reportsLayout);

			if (previous !== undefined) {
				queryClient.setQueryData(
					queryKeys.reportsLayout,
					resolveReportsLayout(mergeReportsLayout(previous, change)),
				);
			}

			return { previous };
		},
		onError: (error, _, context) => {
			if (context?.previous !== undefined) {
				queryClient.setQueryData(queryKeys.reportsLayout, context.previous);
			}

			showFailureToast(error);
		},
		onSuccess: (layout) => {
			if (queryClient.isMutating({ mutationKey: queryKeys.reportsLayout }) <= 1) {
				queryClient.setQueryData(queryKeys.reportsLayout, layout);
			}
		},
	});
}
