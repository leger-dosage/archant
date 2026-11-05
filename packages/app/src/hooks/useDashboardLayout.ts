import type { InferResponseType } from "hono/client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { DashboardLayoutInput } from "@archant/api/schemas/dashboard-layout";
import { mergeLayout, resolveLayout } from "@archant/data/dashboard-layout";

import { api, unwrap } from "@/lib/api";
import { showFailureToast } from "@/lib/error-toast";
import { queryKeys } from "@/lib/query-keys";

export type DashboardLayoutData = InferResponseType<
	(typeof api.dashboard.layout)["$get"],
	200
>["data"];

/**
 * The signed-in user's dashboard: order, collapsed and hidden widgets, sizes.
 * Off for a viewer, who sees the default layout.
 */
export function useDashboardLayout({ enabled }: { enabled: boolean }) {
	return useQuery({
		queryKey: queryKeys.dashboardLayout,
		enabled,
		queryFn: async () => (await unwrap(api.dashboard.layout.$get())).data,
	});
}

/** The layout once a change applies, merged by the code the server merges with. */
function applied(layout: DashboardLayoutData, change: DashboardLayoutInput): DashboardLayoutData {
	return resolveLayout(mergeLayout(layout, change));
}

/**
 * Saves one change to the dashboard, applied in the cache at once as Sure's
 * controllers apply it to the page. A failure puts the layout back and says
 * so.
 */
export function useUpdateDashboardLayout() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationKey: queryKeys.dashboardLayout,
		// One save after the other: an older answer, or the rollback of a failed
		// change, landing after a newer change would put the older layout back.
		scope: { id: "dashboard-layout" },
		mutationFn: async (change: DashboardLayoutInput) =>
			(await unwrap(api.dashboard.layout.$patch({ json: change }))).data,
		onMutate: async (change) => {
			await queryClient.cancelQueries({ queryKey: queryKeys.dashboardLayout });
			const previous = queryClient.getQueryData<DashboardLayoutData>(queryKeys.dashboardLayout);

			if (previous !== undefined) {
				queryClient.setQueryData(queryKeys.dashboardLayout, applied(previous, change));
			}

			return { previous };
		},
		onError: (error, _, context) => {
			if (context?.previous !== undefined) {
				queryClient.setQueryData(queryKeys.dashboardLayout, context.previous);
			}

			showFailureToast(error);
		},
		onSuccess: (layout) => {
			// A change still waiting already shows; this answer does not hold it yet.
			if (queryClient.isMutating({ mutationKey: queryKeys.dashboardLayout }) <= 1) {
				queryClient.setQueryData(queryKeys.dashboardLayout, layout);
			}
		},
	});
}
