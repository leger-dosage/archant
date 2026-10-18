import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/**
 * « Réinitialiser le compte »: deletes every account and what goes with
 * them, and with `sampleData` « Réinitialiser et précharger » loads Sure's
 * sample household in their place. Then resets every query but the
 * session: active ones read again, so each list on screen reads empty, or
 * the sample, without a reload, and inactive ones drop their data, so a page
 * opened later never shows a deleted row while it refetches. The session
 * survives a reset, and resetting it would sign the page out for a moment.
 */
export function useResetFinancialData() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({ sampleData }: { sampleData: boolean }) =>
			(
				await unwrap(
					api["financial-data"].$delete({
						query: sampleData ? { sampleData: "true" } : {},
					}),
				)
			).data,
		onSuccess: async () => {
			await queryClient.resetQueries({
				predicate: (query) => query.queryKey[0] !== queryKeys.session[0],
			});
		},
	});
}
