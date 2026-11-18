import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { HouseholdPreferencesInput } from "@archant/api/schemas/household-preferences";

import { api, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useHouseholdPreferences() {
	return useQuery({
		queryKey: queryKeys.householdPreferences,
		queryFn: async () => (await unwrap(api.preferences.household.$get())).data,
	});
}

export function useUpdateHouseholdPreferences() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (input: HouseholdPreferencesInput) =>
			(await unwrap(api.preferences.household.$patch({ json: input }))).data,
		onSuccess: async (preferences, input) => {
			queryClient.setQueryData(queryKeys.householdPreferences, preferences);

			// The zone changes which day the server uses for its figures and dates.
			if (input.timeZone !== undefined) {
				await queryClient.invalidateQueries();
			}
		},
	});
}
