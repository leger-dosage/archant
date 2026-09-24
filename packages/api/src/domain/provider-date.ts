import type { IsoDate } from "./dates.ts";

import { addDays } from "./dates.ts";

const LEADING_DATE = /^(\d{4})(\d{2})(\d{2})/u;

// Account and transaction dates start in 1900; an older one is a typo.
const EARLIEST_YEAR = 1900;

/**
 * The calendar date a provider printed, from the first eight digits of its
 * timestamp (`YYYYMMDD…`), never converted through a time zone: a card payment
 * booked at 23:30 in Paris stays on that day. `null` when those digits are not
 * a real day.
 */
export function providerDate(text: string): IsoDate | null {
	const match = LEADING_DATE.exec(text);

	if (match === null) {
		return null;
	}

	const [, year = "", month = "", day = ""] = match;
	const date = `${year}-${month}-${day}`;

	// Round-tripping through `addDays` catches 31 April and 29 February outside
	// leap years, which `Date.parse` would silently roll into the next month.
	if (Number(year) < EARLIEST_YEAR || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
		return null;
	}

	return addDays(date, 0) === date ? date : null;
}

// A date, or a date-time: `2026-09-12` or `2026-09-12T08:00:00+02:00`.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T|$)/u;

/**
 * The same literal date part from an ISO 8601 date, as Enable Banking prints
 * it (`2026-09-12`). `null` when the text is not one, or not a real day.
 */
export function providerIsoDate(text: string): IsoDate | null {
	return ISO_DATE.test(text) ? providerDate(text.slice(0, 10).replaceAll("-", "")) : null;
}
