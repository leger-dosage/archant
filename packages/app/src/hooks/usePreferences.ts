import type { InferResponseType } from "hono/client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PreferencesInput } from "@archant/api/schemas/preferences";
import type { SurePeriod } from "@archant/data/periods";

import { api, unwrap } from "@/lib/api";
import { showFailureToast } from "@/lib/error-toast";
import { queryKeys } from "@/lib/query-keys";

type PreferencesData = InferResponseType<typeof api.preferences.$get, 200>["data"];

/** The signed-in user's preferences, « Réglages › Préférences ». */
export function usePreferences() {
	return useQuery({
		queryKey: queryKeys.preferences.all,
		queryFn: async () => (await unwrap(api.preferences.$get())).data,
	});
}

/**
 * Saves the preferences; the answer is the new state. Every account list
 * reads the order from the server, and every transaction list the split
 * grouping, so they are read again.
 */
export function useUpdatePreferences() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (input: PreferencesInput) =>
			(await unwrap(api.preferences.$patch({ json: input }))).data,
		onSuccess: async (preferences) => {
			queryClient.setQueryData(queryKeys.preferences.all, preferences);
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: queryKeys.accounts.all }),
				queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all }),
			]);
		},
	});
}

/**
 * Saves the chart period an administrator picked, as Sure's `Periodable`
 * saves `default_period`. Set in the cache at once, so another page opens on
 * it; no list depends on it, so nothing is read again. A failure puts the
 * old one back and says so; the address keeps the pick.
 */
export function useSaveDefaultPeriod() {
	const queryClient = useQueryClient();

	return useMutation({
		// One save after the other: an older answer, or the rollback of a failed
		// pick, landing after a newer pick would put the older period back.
		scope: { id: "default-period" },
		mutationFn: async (defaultPeriod: SurePeriod) =>
			(await unwrap(api.preferences.$patch({ json: { defaultPeriod } }))).data,
		onMutate: async (defaultPeriod) => {
			await queryClient.cancelQueries({ queryKey: queryKeys.preferences.all });
			const previous = queryClient.getQueryData<PreferencesData>(queryKeys.preferences.all);

			if (previous !== undefined) {
				queryClient.setQueryData<PreferencesData>(queryKeys.preferences.all, {
					...previous,
					defaultPeriod,
				});
			}

			return { previous };
		},
		onError: (error, _, context) => {
			if (context?.previous !== undefined) {
				queryClient.setQueryData(queryKeys.preferences.all, context.previous);
			}

			showFailureToast(error);
		},
		onSuccess: (preferences) => {
			queryClient.setQueryData(queryKeys.preferences.all, preferences);
		},
	});
}
