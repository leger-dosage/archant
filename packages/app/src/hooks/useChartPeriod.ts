import type { PeriodSearch } from "@/lib/periods";

import type { SurePeriod } from "@archant/data/periods";

import { useIsAdmin } from "@/hooks/useIsAdmin";
import { usePreferences, useSaveDefaultPeriod } from "@/hooks/usePreferences";
import { namesPeriod, selectedPeriod } from "@/lib/periods";

/**
 * The period the dashboard and the account page chart: the address's, else
 * the user's saved one. `ready` is false while the saved one loads and the
 * address names none, so a chart does not read the default first and then
 * the saved period. `save` keeps an administrator's pick as the saved period,
 * as Sure's `Periodable`; a viewer's pick stays in the address alone (AD-21).
 */
export function useChartPeriod(search: PeriodSearch) {
	const preferences = usePreferences();
	const saveDefault = useSaveDefaultPeriod();
	const admin = useIsAdmin();
	const named = namesPeriod(search);

	return {
		chart: selectedPeriod(search, preferences.data?.defaultPeriod),
		ready: named || !preferences.isPending,
		save: (period: SurePeriod) => {
			if (admin) {
				saveDefault.mutate(period);
			}
		},
	};
}
