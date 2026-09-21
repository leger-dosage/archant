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

export function addDays(date: IsoDate, days: number): IsoDate {
	return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function maxDate(a: IsoDate, b: IsoDate): IsoDate {
	return a > b ? a : b;
}

export function minDate(a: IsoDate, b: IsoDate): IsoDate {
	return a < b ? a : b;
}

function daysInMonth(year: number, month: number): number {
	if (month === 2) {
		const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

		return leap ? 29 : 28;
	}

	return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * The same day `months` calendar months later, or earlier when negative. A day
 * the target month lacks is clamped to its last day, as Rails' `months.ago`
 * does for Sure's periods: one month before 31 March is 28 or 29 February.
 */
export function addMonths(date: IsoDate, months: number): IsoDate {
	const year = Number(date.slice(0, 4));
	const month = Number(date.slice(5, 7));
	const day = Number(date.slice(8, 10));
	const index = year * 12 + (month - 1) + months;
	const targetYear = Math.floor(index / 12);
	const targetMonth = index - targetYear * 12 + 1;
	const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth));

	return [
		String(targetYear).padStart(4, "0"),
		String(targetMonth).padStart(2, "0"),
		String(targetDay).padStart(2, "0"),
	].join("-");
}
