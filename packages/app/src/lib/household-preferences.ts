import type { HouseholdDateFormat } from "@archant/data/household-preferences";
import { DATE_FORMATS, HOUSEHOLD_COUNTRIES } from "@archant/data/household-preferences";
import { CURRENCY_CODES } from "@archant/data/money";

import { intlLocale } from "@/lib/locale";

const regionNames = new Intl.DisplayNames(intlLocale, { type: "region" });
const currencyNames = new Intl.DisplayNames(intlLocale, { type: "currency" });
const byLabel = new Intl.Collator(intlLocale);

export const countryOptions = HOUSEHOLD_COUNTRIES.map((value) => ({
	value,
	label: regionNames.of(value) ?? value,
})).toSorted((a, b) => byLabel.compare(a.label, b.label));

export const currencyLabel = (code: string) => `${code} · ${currencyNames.of(code) ?? code}`;

export const currencyOptions = CURRENCY_CODES.map((value) => ({
	value,
	label: currencyLabel(value),
}));

export const dateFormatOptions = DATE_FORMATS.map((value) => ({ value, label: value }));

// ICU may omit UTC and accept legacy aliases that are absent from this list.
const timeZones = ["UTC", ...Intl.supportedValuesOf("timeZone")];

export function timeZoneOptions(current: string) {
	return (timeZones.includes(current) ? timeZones : [current, ...timeZones]).map((value) => ({
		value,
		label: value,
	}));
}

// Sure uses strftime directly, so %b uses English names and %e pads with a space.
const shortMonths = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

export function formatHouseholdDate(iso: string, format: HouseholdDateFormat): string {
	const year = iso.slice(0, 4);
	const month = iso.slice(5, 7);
	const day = iso.slice(8, 10);

	const tokens = new Map([
		["YYYY", year],
		["MMM", shortMonths[Number(month) - 1] ?? ""],
		["MM", month],
		["DD", day],
		["D", String(Number(day)).padStart(2, " ")],
	]);

	return format.replace(/YYYY|MMM|MM|DD|D/gu, (token) => tokens.get(token) ?? token);
}
