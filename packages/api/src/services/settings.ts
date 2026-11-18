import type { ServiceDeps } from "./deps.ts";

import { eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import type { HouseholdCountry, HouseholdDateFormat } from "@archant/data/household-preferences";
import {
	DATE_FORMATS,
	DEFAULT_HOUSEHOLD_COUNTRY,
	defaultDateFormat,
	isHouseholdCountry,
	isTimeZone,
} from "@archant/data/household-preferences";
import type { CurrencyCode } from "@archant/data/money";
import { DEFAULT_CURRENCY, isCurrencyCode } from "@archant/data/money";
import { settings } from "@archant/data/schema/settings";

import { householdLocale } from "./household-locale.ts";

type Reader = Pick<ServiceDeps["db"], "select">;

type HouseholdPreferences = {
	country: HouseholdCountry;
	baseCurrency: CurrencyCode;
	dateFormat: HouseholdDateFormat;
	timeZone: string;
	monthStartDay: number;
};

type PreferencePatch = {
	[Field in keyof HouseholdPreferences]?: HouseholdPreferences[Field] | undefined;
};

const excluded = alias(settings, "excluded");

const KEYS = {
	country: "country",
	baseCurrency: "base_currency",
	dateFormat: "date_format",
	timeZone: "time_zone",
	monthStartDay: "month_start_day",
} satisfies Record<keyof HouseholdPreferences, string>;

async function readSetting(db: Reader, key: string): Promise<string | undefined> {
	const row = await db
		.select({ value: settings.value })
		.from(settings)
		.where(eq(settings.key, key))
		.get();

	return row?.value;
}

function reportingCurrency(value: string | undefined): CurrencyCode {
	return value !== undefined && isCurrencyCode(value) ? value : DEFAULT_CURRENCY;
}

/** The currency used for cross-account totals (AD-6). */
export async function getReportingCurrency(db: Reader): Promise<CurrencyCode> {
	return reportingCurrency(await readSetting(db, KEYS.baseCurrency));
}

function storedTimeZone(value: string | undefined, fallback: string): string {
	return value !== undefined && isTimeZone(value) ? value : fallback;
}

export async function householdTimeZone(db: Reader, fallback: string): Promise<string> {
	return storedTimeZone(await readSetting(db, KEYS.timeZone), fallback);
}

function storedMonthStartDay(value: string | undefined): number {
	const day = Number(value);

	return Number.isInteger(day) && day >= 1 && day <= 28 ? day : 1;
}

export async function getMonthStartDay(db: Reader): Promise<number> {
	return storedMonthStartDay(await readSetting(db, KEYS.monthStartDay));
}

export async function getHouseholdPreferences({
	db,
	timeZone,
}: ServiceDeps): Promise<HouseholdPreferences> {
	const rows = await db
		.select()
		.from(settings)
		.where(inArray(settings.key, Object.values(KEYS)));
	const values = new Map(rows.map(({ key, value }) => [key, value]));
	const country = values.get(KEYS.country) ?? "";
	const dateFormat = DATE_FORMATS.find((format) => format === values.get(KEYS.dateFormat));

	return {
		country: isHouseholdCountry(country) ? country : DEFAULT_HOUSEHOLD_COUNTRY,
		baseCurrency: reportingCurrency(values.get(KEYS.baseCurrency)),
		dateFormat: dateFormat ?? defaultDateFormat(await householdLocale(db)),
		timeZone: storedTimeZone(values.get(KEYS.timeZone), timeZone),
		monthStartDay: storedMonthStartDay(values.get(KEYS.monthStartDay)),
	};
}

function rowsFor(input: PreferencePatch) {
	const updatedAt = Date.now();

	const values = [
		[KEYS.country, input.country],
		[KEYS.baseCurrency, input.baseCurrency],
		[KEYS.dateFormat, input.dateFormat],
		[KEYS.timeZone, input.timeZone],
		[KEYS.monthStartDay, input.monthStartDay],
	] as const;

	return values.flatMap(([key, value]) =>
		value === undefined ? [] : [{ key, value: String(value), updatedAt }],
	);
}

/** Existing installations keep every setting they already saved. */
export async function backfillHouseholdPreferences({ db, timeZone }: ServiceDeps): Promise<void> {
	const locale = await householdLocale(db);
	await db
		.insert(settings)
		.values(
			rowsFor({
				country: DEFAULT_HOUSEHOLD_COUNTRY,
				baseCurrency: DEFAULT_CURRENCY,
				dateFormat: defaultDateFormat(locale),
				timeZone,
				monthStartDay: 1,
			}),
		)
		.onConflictDoNothing();
}

/** Only supplied fields are written, so two edits to different fields coexist. */
export async function saveHouseholdPreferences(
	db: Pick<ServiceDeps["db"], "insert">,
	input: PreferencePatch,
): Promise<void> {
	const rows = rowsFor(input);

	if (rows.length > 0) {
		await db
			.insert(settings)
			.values(rows)
			.onConflictDoUpdate({
				target: settings.key,
				set: { value: excluded.value, updatedAt: excluded.updatedAt },
			});
	}
}
