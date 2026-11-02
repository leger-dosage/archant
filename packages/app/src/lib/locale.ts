import type { Locale } from "@archant/data/locales";
import { INTL_LOCALES, LOCALES, pickLocale } from "@archant/data/locales";

const STORAGE_KEY = "archant.locale";

function storedLocale(): Locale | null {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);

		return LOCALES.find((locale) => locale === stored) ?? null;
	} catch {
		return null;
	}
}

function browserLocale(): Locale {
	return pickLocale(globalThis.navigator?.languages ?? []);
}

/**
 * The language this page runs in, read once when the bundle loads: the user's
 * saved choice, kept in `localStorage` so the sign-in page and the first paint
 * of a reload already speak it, else the browser's. Changing it reloads the
 * page, because the `Intl` formatters the modules build as they load, and the
 * strings they hold, would otherwise keep the old language.
 */
export const activeLocale: Locale = storedLocale() ?? browserLocale();

/** The tag `Intl` formats dates, numbers and sorts with. */
export const intlLocale = INTL_LOCALES[activeLocale];

/**
 * Follows the server's `users.locale` of the signed-in user: null is the
 * browser's language. Returns true when the page must reload to change
 * language. A browser without storage cannot keep the choice, so it reloads
 * never, rather than in a loop.
 */
export function followSavedLocale(saved: Locale | null): boolean {
	try {
		if (saved === null) {
			localStorage.removeItem(STORAGE_KEY);
		} else {
			localStorage.setItem(STORAGE_KEY, saved);
		}
	} catch {
		return false;
	}

	return (saved ?? browserLocale()) !== activeLocale;
}
