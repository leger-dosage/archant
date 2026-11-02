import { useEffect } from "react";

import { usePreferences } from "@/hooks/usePreferences";
import { followSavedLocale } from "@/lib/locale";

/**
 * Brings the page to the language the signed-in user saved, on any device:
 * the choice lives on the server, and the page reads it from `localStorage`
 * when it loads. A different language reloads once; the next load already
 * speaks it, so this never loops.
 */
export function useFollowSavedLocale(): void {
	const saved = usePreferences().data?.locale;

	useEffect(() => {
		if (saved !== undefined && followSavedLocale(saved)) {
			location.reload();
		}
	}, [saved]);
}
