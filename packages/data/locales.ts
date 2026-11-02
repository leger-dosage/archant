// Apart from the `users` table, so the interface reads the locales without
// bundling Drizzle.

/**
 * The interface languages, as Sure's `LanguagesHelper::SUPPORTED_LOCALES`
 * names them. A language joins here once `packages/app/src/locales/` holds
 * its file.
 */
export const LOCALES = ["en", "fr"] as const;

export type Locale = (typeof LOCALES)[number];

/** Sure's `I18n.default_locale`, the language of a browser Archant has no file for. */
export const DEFAULT_LOCALE: Locale = "en";

/**
 * The BCP 47 tag `Intl` formats dates, numbers and sorts with. Regional on
 * purpose: Sure's English writes « Oct 14, 2026 » and « 1,234.56 », which
 * is `en-US`.
 */
export const INTL_LOCALES: Record<Locale, string> = { en: "en-US", fr: "fr-FR" };

/**
 * The first language of the browser's list that Archant has a file for, by
 * its primary subtag (`fr-CA` reads `fr`), as Sure's `accept_language_top_locale`;
 * the default when none matches.
 */
export function pickLocale(languages: readonly string[]): Locale {
	for (const language of languages) {
		const primary = language.trim().toLowerCase().split(/[-_]/)[0];
		const found = LOCALES.find((locale) => locale === primary);

		if (found !== undefined) {
			return found;
		}
	}

	return DEFAULT_LOCALE;
}
