import { daysInMonth, shiftMonth } from "@archant/data/months";

/**
 * Calendar dates are `YYYY-MM-DD` strings throughout. They compare correctly
 * as strings, and arithmetic goes through UTC midnight so that no local time
 * zone or daylight-saving shift can move a day.
 */
export type IsoDate = string;

const DAY_MS = 86_400_000;

/** The calendar date it is right now in `timeZone`. */
export function today(timeZone: string, now: Date = new Date()): IsoDate {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(now);
	const values = new Map(parts.map((part) => [part.type, part.value]));

	// Assembled from parts rather than trusting a locale's pattern: en-CA's
	// short date has changed shape in a browser release before.
	return [values.get("year"), values.get("month"), values.get("day")].join("-");
}

/** How far `timeZone`'s wall clock runs ahead of UTC at `instant`, in milliseconds. */
function offsetAt(timeZone: string, instant: number): number {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		hourCycle: "h23",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	}).formatToParts(new Date(instant));
	const value = (type: Intl.DateTimeFormatPartTypes) =>
		Number(parts.find((part) => part.type === type)?.value);
	const wallClock = Date.UTC(
		value("year"),
		value("month") - 1,
		value("day"),
		value("hour"),
		value("minute"),
		value("second"),
	);

	return wallClock - (instant - (((instant % 1000) + 1000) % 1000));
}

/**
 * Epoch milliseconds of the midnight that began today in `timeZone`. The
 * offset is read twice, the second time at the first guess: a day that
 * changes offset starts under the offset of its midnight, not of the moment
 * asked about. A zone whose clocks skip midnight starts the day at the first
 * instant that exists.
 */
export function startOfDay(timeZone: string, now: number): number {
	const day = today(timeZone, new Date(now));
	const midnightUtc = Date.parse(`${day}T00:00:00Z`);
	const guess = midnightUtc - offsetAt(timeZone, midnightUtc);
	const start = midnightUtc - offsetAt(timeZone, guess);

	return today(timeZone, new Date(start)) === day ? start : guess;
}

export function addDays(date: IsoDate, days: number): IsoDate {
	return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`, negative when `to` is earlier. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
	return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** The day of the week, 0 being Sunday, as Ruby's `Date#wday`. */
export function weekdayOf(date: IsoDate): number {
	return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function maxDate(a: IsoDate, b: IsoDate): IsoDate {
	return a > b ? a : b;
}

export function minDate(a: IsoDate, b: IsoDate): IsoDate {
	return a < b ? a : b;
}

/**
 * The same day `months` calendar months later, or earlier when negative. A day
 * the target month lacks is clamped to its last day, as Rails' `months.ago`
 * does for Sure's periods: one month before 31 March is 28 or 29 February.
 */
export function addMonths(date: IsoDate, months: number): IsoDate {
	const month = shiftMonth(date.slice(0, 7), months);
	const lastDay = daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)));

	return `${month}-${String(Math.min(Number(date.slice(8, 10)), lastDay)).padStart(2, "0")}`;
}

/**
 * `day` of the month `date` falls in, clamped to that month's last day: the
 * 31st of a 30-day month is its 30th, as Sure's `[expected_day, days_in_month].min`.
 */
export function withDay(date: IsoDate, day: number): IsoDate {
	const lastDay = daysInMonth(Number(date.slice(0, 4)), Number(date.slice(5, 7)));

	return `${date.slice(0, 8)}${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

/** A calendar month as `YYYY-MM`. */
export type IsoMonth = string;

/** The first and last days of a calendar month, both inclusive. */
export function monthRange(month: IsoMonth): { from: IsoDate; to: IsoDate } {
	const year = Number(month.slice(0, 4));
	const monthNumber = Number(month.slice(5, 7));

	return {
		from: `${month}-01`,
		to: `${month}-${String(daysInMonth(year, monthNumber)).padStart(2, "0")}`,
	};
}
