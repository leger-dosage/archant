import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PreferencesInput } from "@archant/api/schemas/preferences";

import { api, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/** The signed-in user's preferences, « Réglages › Préférences ». */
export function usePreferences() {
	return useQuery({
		queryKey: queryKeys.preferences.all,
		queryFn: async () => (await unwrap(api.preferences.$get())).data,
	});
}

/**
 * Saves the preferences; the answer is the new state. Every account list
 * reads the order from the server, so they are read again.
 */
export function useUpdatePreferences() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (input: PreferencesInput) =>
			(await unwrap(api.preferences.$patch({ json: input }))).data,
		onSuccess: async (preferences) => {
			queryClient.setQueryData(queryKeys.preferences.all, preferences);
			await queryClient.invalidateQueries({ queryKey: queryKeys.accounts.all });
		},
	});
}
