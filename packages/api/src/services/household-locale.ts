import { eq } from "drizzle-orm";

import type { Database } from "@archant/data/client";
import type { Locale } from "@archant/data/locales";
import { LOCALES } from "@archant/data/locales";
import { settings } from "@archant/data/schema/settings";

const KEY = "locale";

/**
 * Sure's `Family.locale`: the language of what the server writes into the
 * household's data, the default categories and the names of a transfer. Apart
 * from `users.locale`, which only changes what a member reads. A household
 * with no row is one created before Story 37.2, whose data is French.
 */
export async function householdLocale(db: Pick<Database, "select">): Promise<Locale> {
	const row = await db
		.select({ value: settings.value })
		.from(settings)
		.where(eq(settings.key, KEY))
		.get();

	return LOCALES.find((locale) => locale === row?.value) ?? "fr";
}

/** Saves the household's language; what is already stored is not renamed. */
export async function saveHouseholdLocale(
	db: Pick<Database, "insert">,
	locale: Locale,
): Promise<void> {
	const now = Date.now();

	await db
		.insert(settings)
		.values({ key: KEY, value: locale, updatedAt: now })
		.onConflictDoUpdate({ target: settings.key, set: { value: locale, updatedAt: now } });
}
