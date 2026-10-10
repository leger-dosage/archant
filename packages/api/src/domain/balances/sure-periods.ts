import type { IsoDate } from "../dates.ts";
import type { DateRange } from "./history.ts";

import { addDays, addMonths, daysBetween } from "../dates.ts";

/** Sure's `Period::PERIODS` keys, in its order. */
export const SURE_PERIODS = [
	"last_day",
	"current_week",
	"last_7_days",
	"current_month",
	"last_month",
	"last_30_days",
	"last_90_days",
	"current_year",
	"last_365_days",
	"last_5_years",
	"last_10_years",
	"all_time",
] as const;

export type SurePeriod = (typeof SURE_PERIODS)[number];

/** Sure's `GetBalanceSheet::INTERVALS`, the steps of its history series. */
export const SURE_INTERVALS = ["1 day", "1 week", "1 month"] as const;

export type SureInterval = (typeof SURE_INTERVALS)[number];

/**
 * The days Sure's `Period.from_key` gives a key on `today`. Weeks start on
 * Monday, as Rails' `beginning_of_week`. `all_time` starts at the oldest
 * entry, or five years back when there is none before today.
 */
export function surePeriodRange(
	key: SurePeriod,
	today: IsoDate,
	oldestEntry: IsoDate | null,
): DateRange {
	const lastMonth = addMonths(today, -1);
	const ranges: Record<SurePeriod, () => DateRange> = {
		last_day: () => ({ from: addDays(today, -1), to: today }),
		current_week: () => {
			const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();

			return { from: addDays(today, -((weekday + 6) % 7)), to: today };
		},
		last_7_days: () => ({ from: addDays(today, -7), to: today }),
		current_month: () => ({ from: `${today.slice(0, 7)}-01`, to: today }),
		last_month: () => ({
			from: `${lastMonth.slice(0, 7)}-01`,
			to: addDays(`${today.slice(0, 7)}-01`, -1),
		}),
		last_30_days: () => ({ from: addDays(today, -30), to: today }),
		last_90_days: () => ({ from: addDays(today, -90), to: today }),
		current_year: () => ({ from: `${today.slice(0, 4)}-01-01`, to: today }),
		last_365_days: () => ({ from: addDays(today, -365), to: today }),
		last_5_years: () => ({ from: addMonths(today, -60), to: today }),
		last_10_years: () => ({ from: addMonths(today, -120), to: today }),
		all_time: () => ({
			from: oldestEntry !== null && oldestEntry < today ? oldestEntry : addMonths(today, -60),
			to: today,
		}),
	};

	return ranges[key]();
}

/**
 * Sure's `Period#interval`: a day's step up to a calendar year, a week's up
 * to five, a month's beyond.
 */
export function periodInterval(range: DateRange): SureInterval {
	if (range.to > addMonths(range.from, 60)) {
		return "1 month";
	}

	return range.to > addMonths(range.from, 12) ? "1 week" : "1 day";
}

const DAYS_PER_POINT: Record<SureInterval, number> = { "1 day": 1, "1 week": 7, "1 month": 30 };

/** Sure's `series_points`: the range's days over the interval's, rounded down. */
export function seriesPointCount(range: DateRange, interval: SureInterval): number {
	return Math.floor((daysBetween(range.from, range.to) + 1) / DAYS_PER_POINT[interval]);
}

/**
 * The days Sure's chart series reads: PostgreSQL's `generate_series` from
 * the first day by the interval, each step added to the previous one, so 31
 * January then 28 February then 28 March, and the last day always.
 */
export function seriesDates(range: DateRange, interval: SureInterval): IsoDate[] {
	const step = (date: IsoDate) =>
		interval === "1 day"
			? addDays(date, 1)
			: interval === "1 week"
				? addDays(date, 7)
				: addMonths(date, 1);
	const dates: IsoDate[] = [];

	for (let date = range.from; date <= range.to; date = step(date)) {
		dates.push(date);
	}

	return dates.at(-1) === range.to ? dates : [...dates, range.to];
}
