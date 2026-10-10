import type { IsoDate } from "../dates.ts";
import type { DailyBalance } from "./forward.ts";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";

import { addDays, addMonths, maxDate } from "../dates.ts";

export type DateRange = { from: IsoDate; to: IsoDate };

/**
 * The days a period covers: from `today` minus `months` calendar months, or
 * from the opening date for `all`, to `today`. Never before the opening date, since a line
 * before the account existed would read as a real balance. `null` when the
 * account opens after today and the period holds no day.
 */
export function periodRange(
	months: number | "all",
	today: IsoDate,
	openingDate: IsoDate,
): DateRange | null {
	if (openingDate > today) {
		return null;
	}

	const start = months === "all" ? openingDate : addMonths(today, -months);

	return { from: maxDate(start, openingDate), to: today };
}

export type BalanceChange = {
	amount: MinorUnits;
	/**
	 * Percentage points, one decimal, relative to the first balance's size.
	 * `null` when the period starts at zero, where any change is infinite: the
	 * interface then shows the amount alone, as Sure's `Trend` does.
	 */
	percent: number | null;
};

/** The last point minus the first; `null` for an empty series. */
export function balanceChange(points: readonly DailyBalance[]): BalanceChange | null {
	const first = points.at(0);
	const last = points.at(-1);

	if (first === undefined || last === undefined) {
		return null;
	}

	const amount = last.balance - first.balance;
	// Rounded on the magnitude so a rise and a fall of the same size round alike:
	// `Math.round` alone sends −0.25 to −0.2 but +0.25 to +0.3.
	const ratio = amount / Math.abs(first.balance);
	const percent =
		first.balance === 0 ? null : (Math.sign(ratio) * Math.round(Math.abs(ratio) * 1000)) / 10;

	return { amount: toMinorUnits(amount), percent };
}

/**
 * One balance per day from `from` to `to`, both included. `known` holds stored
 * rows, oldest first, and may start before `from`. A day without a row carries
 * the previous balance, as `balanceOn` reads it: rows stop at the last write's
 * end, so an account left untouched for a month has none for that month. Days
 * before the first known row, when the account did not exist yet, are left out.
 */
export function fillDays(
	known: readonly DailyBalance[],
	from: IsoDate,
	to: IsoDate,
): DailyBalance[] {
	const points: DailyBalance[] = [];
	let next = 0;
	let current: MinorUnits | undefined;

	for (let date = from; date <= to; date = addDays(date, 1)) {
		for (let row = known[next]; row !== undefined && row.date <= date; row = known[next]) {
			current = row.balance;
			next += 1;
		}

		if (current !== undefined) {
			points.push({ date, balance: current });
		}
	}

	return points;
}

const SERIES_INTERVALS = ["day", "week", "month"] as const;

type SeriesInterval = (typeof SERIES_INTERVALS)[number];

export type SampledSeries = { interval: SeriesInterval; points: DailyBalance[] };

/** The Monday starting `date`'s week, as ISO 8601 counts weeks. */
function weekOf(date: IsoDate): IsoDate {
	const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();

	return addDays(date, -((weekday + 6) % 7));
}

/**
 * Sure's `Period#interval`: every day up to a calendar year from the first
 * point to the last, every week beyond, every month beyond five years.
 */
function intervalOf(points: readonly DailyBalance[]): SeriesInterval {
	const first = points.at(0);
	const last = points.at(-1);

	if (first === undefined || last === undefined || last.date <= addMonths(first.date, 12)) {
		return "day";
	}

	return last.date <= addMonths(first.date, 60) ? "week" : "month";
}

/**
 * A daily series thinned as Sure's `Period#interval` does, or at `interval`
 * when given, so series charted together share one. Each week or month keeps
 * its last day, so the last point stays the last day, today, and still equals
 * the headline figure. Ten years of days become about 120 points, a size an
 * assistant reads without spending its context on it.
 */
export function sampleSeries(
	points: readonly DailyBalance[],
	interval: SeriesInterval = intervalOf(points),
): SampledSeries {
	if (interval === "day") {
		return { interval, points: [...points] };
	}

	const bucketOf = interval === "week" ? weekOf : (date: IsoDate) => date.slice(0, 7);
	const lastOfBucket = new Map<string, DailyBalance>();

	// Points are oldest first, so each bucket ends holding its latest one, and
	// a Map keeps the buckets in the order they first appear.
	for (const point of points) {
		lastOfBucket.set(bucketOf(point.date), point);
	}

	return { interval, points: [...lastOfBucket.values()] };
}
