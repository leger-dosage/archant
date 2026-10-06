import type { IsoDate } from "../dates.ts";

import { daysInMonth } from "@archant/data/months";
import { LAST_DAY_OF_MONTH } from "@archant/data/recurring";

import { addDays, addMonths, daysBetween, weekdayOf, withDay } from "../dates.ts";

/**
 * Sure's `Schedule::DAY_MATCH_TOLERANCE`: how far a payment may land from its
 * occurrence and still be it, shared by detection and the matcher.
 */
export const DAY_MATCH_TOLERANCE = 2;

// Sure's `SEARCH_CAP_DAYS`: `firstOccurrenceAfter` gives up after ten years.
const SEARCH_CAP_DAYS = 366 * 10;

export const DAYS_PER_YEAR = 365.25;

/**
 * One of Sure's `RecurrenceRule` shapes, as the database checks them: a
 * weekly rule falls on a weekday, 0 being Sunday; a monthly one on a day of
 * the month, −1 for its last; a yearly one on a day of a month.
 */
export type RecurrenceRule =
	| { frequency: "weekly"; interval: number; weekday: number }
	| { frequency: "monthly"; interval: number; dayOfMonth: number }
	| { frequency: "yearly"; interval: number; dayOfMonth: number; monthOfYear: number };

/**
 * Sure's `Schedule` with the weekend adjustment `none`, no end date and no
 * nth weekday, which no Sure screen sets.
 */
export type Schedule = {
	/** Never empty: every series has at least one rule. */
	rules: readonly RecurrenceRule[];
	/** Which week, month or year an every-N rule falls in: `anchor_date ?? last_occurrence_date`. */
	anchorDate: IsoDate;
	/** Sure's `after_count`: the first this many occurrences from the anchor, then none. */
	endAfterCount: number | null;
	/** What Sure's legacy shims read for a plain monthly series. */
	expectedDayOfMonth: number;
};

/** Never negative, as Ruby's `%` for a positive divisor. */
const modulo = (value: number, divisor: number) => ((value % divisor) + divisor) % divisor;

const yearOf = (date: IsoDate) => Number(date.slice(0, 4));

const monthOf = (date: IsoDate) => Number(date.slice(5, 7));

const monthIndex = (date: IsoDate) => yearOf(date) * 12 + monthOf(date);

const firstOfMonth = (date: IsoDate) => `${date.slice(0, 8)}01`;

const sortedUnique = (dates: readonly IsoDate[]) => [...new Set(dates)].toSorted();

/** The rule's day in the month `date` falls in: the last for −1, else clamped to the month's end. */
function dateInMonth(dayOfMonth: number, date: IsoDate): IsoDate {
	return withDay(date, dayOfMonth === LAST_DAY_OF_MONTH ? 31 : dayOfMonth);
}

/** Every `7 × interval` days from the anchor's week, backward as well as forward. */
function weeklyOccurrences(
	rule: Extract<RecurrenceRule, { frequency: "weekly" }>,
	anchor: IsoDate,
	start: IsoDate,
	end: IsoDate,
): IsoDate[] {
	const step = 7 * rule.interval;
	const base = addDays(anchor, modulo(rule.weekday - weekdayOf(anchor), 7));
	const found: IsoDate[] = [];

	for (
		let cursor = addDays(base, Math.ceil(daysBetween(base, start) / step) * step);
		cursor <= end;
		cursor = addDays(cursor, step)
	) {
		found.push(cursor);
	}

	return found;
}

/** Every `interval` months from the anchor's month, clamped to each month's end. */
function monthlyOccurrences(
	rule: Extract<RecurrenceRule, { frequency: "monthly" }>,
	anchor: IsoDate,
	start: IsoDate,
	end: IsoDate,
): IsoDate[] {
	const found: IsoDate[] = [];

	for (let month = firstOfMonth(start); month <= end; month = addMonths(month, 1)) {
		const date = dateInMonth(rule.dayOfMonth, month);

		if (
			modulo(monthIndex(month) - monthIndex(anchor), rule.interval) === 0 &&
			date >= start &&
			date <= end
		) {
			found.push(date);
		}
	}

	return found;
}

/** Every `interval` years from the anchor's year. */
function yearlyOccurrences(
	rule: Extract<RecurrenceRule, { frequency: "yearly" }>,
	anchor: IsoDate,
	start: IsoDate,
	end: IsoDate,
): IsoDate[] {
	const found: IsoDate[] = [];

	for (let year = yearOf(start); year <= yearOf(end); year += 1) {
		const month = `${String(year).padStart(4, "0")}-${String(rule.monthOfYear).padStart(2, "0")}-01`;
		const date = dateInMonth(rule.dayOfMonth, month);

		if (modulo(year - yearOf(anchor), rule.interval) === 0 && date >= start && date <= end) {
			found.push(date);
		}
	}

	return found;
}

/** One rule's dates from `start` to `end`, both included, before any end. */
function rawOccurrences(
	rule: RecurrenceRule,
	anchor: IsoDate,
	start: IsoDate,
	end: IsoDate,
): IsoDate[] {
	switch (rule.frequency) {
		case "weekly":
			return weeklyOccurrences(rule, anchor, start, end);
		case "monthly":
			return monthlyOccurrences(rule, anchor, start, end);
		default:
			return yearlyOccurrences(rule, anchor, start, end);
	}
}

/** Sure's `lifetime_occurrences`: the first `endAfterCount` occurrences from the anchor, up to `through`. */
function lifetime(schedule: Schedule, endAfterCount: number, through: IsoDate): IsoDate[] {
	const last = through > schedule.anchorDate ? through : schedule.anchorDate;

	return sortedUnique(
		schedule.rules.flatMap((rule) =>
			rawOccurrences(rule, schedule.anchorDate, schedule.anchorDate, last),
		),
	).slice(0, endAfterCount);
}

/** Sure's `ended_before?`: every payment of an installment falls by `date`. */
function endedBefore(schedule: Schedule, date: IsoDate): boolean {
	return (
		schedule.endAfterCount !== null &&
		lifetime(schedule, schedule.endAfterCount, date).length >= schedule.endAfterCount
	);
}

/** Sure's `longest_period_days`: the longest gap between two occurrences of a rule, padded. */
function longestPeriodDays(schedule: Schedule): number {
	const PERIOD_DAYS = { weekly: 7, monthly: 31, yearly: 366 } as const;

	return (
		Math.max(...schedule.rules.map((rule) => PERIOD_DAYS[rule.frequency] * rule.interval)) + 40
	);
}

/** Every occurrence from `start` to `end`, both included, sorted, an installment's past its count left out. */
export function occurrencesBetween(schedule: Schedule, start: IsoDate, end: IsoDate): IsoDate[] {
	if (start > end) {
		return [];
	}

	if (schedule.endAfterCount !== null) {
		return lifetime(schedule, schedule.endAfterCount, end).filter(
			(date) => date >= start && date <= end,
		);
	}

	return sortedUnique(
		schedule.rules.flatMap((rule) => rawOccurrences(rule, schedule.anchorDate, start, end)),
	);
}

/** The first occurrence strictly after `date`; `null` once an installment has ended, or ten years on. */
export function firstOccurrenceAfter(schedule: Schedule, date: IsoDate): IsoDate | null {
	const window = longestPeriodDays(schedule);
	const cap = addDays(date, SEARCH_CAP_DAYS);

	for (let cursor = addDays(date, 1); cursor <= cap; cursor = addDays(cursor, window + 1)) {
		const windowEnd = addDays(cursor, window);
		const [found] = occurrencesBetween(schedule, cursor, windowEnd);

		if (found !== undefined) {
			return found;
		}

		if (endedBefore(schedule, windowEnd)) {
			return null;
		}
	}

	return null;
}

/** A cycle: from an occurrence, included, to the next one, left out. */
export type Cycle = { start: IsoDate; end: IsoDate };

/**
 * Sure's `cycle_for`: from the last occurrence on or before `date` to the
 * next one; a monthly bill's cycle is its billing month. `null` when an
 * installment has no occurrence around `date`.
 */
export function cycleFor(schedule: Schedule, date: IsoDate): Cycle | null {
	const window = longestPeriodDays(schedule);
	const from = addDays(date, -window * 2);
	const start =
		occurrencesBetween(schedule, from, date).at(-1) ??
		firstOccurrenceAfter(schedule, addDays(from, -1));

	if (start === null) {
		return null;
	}

	const end = firstOccurrenceAfter(schedule, start);

	return end === null ? null : { start, end };
}

/** Sure's `occurrences_per_year`, summed over the rules: a float, never money. */
export function occurrencesPerYear(schedule: Schedule): number {
	return schedule.rules.reduce((sum, rule) => {
		switch (rule.frequency) {
			case "weekly":
				return sum + DAYS_PER_YEAR / (7 * rule.interval);
			case "monthly":
				return sum + 12 / rule.interval;
			default:
				return sum + 1 / rule.interval;
		}
	}, 0);
}

/**
 * Sure's installment plan end in `default_horizon`: `count + 1` cycles of the
 * schedule, each rounded up to whole days, from `start`, so the horizon holds
 * an installment's last payment.
 */
export function planEnd(schedule: Schedule, start: IsoDate, count: number): IsoDate {
	return addDays(start, Math.ceil(DAYS_PER_YEAR / occurrencesPerYear(schedule)) * (count + 1));
}

/**
 * Sure's `matches_day?`: whether one of a rule's own occurrences lies within
 * 2 days of `date`, or on it exactly for a weekly rule, so an every-N cadence
 * refuses a date in the wrong cycle and an ended installment claims none.
 */
export function matchesDay(schedule: Schedule, date: IsoDate): boolean {
	return schedule.rules.some((rule) => {
		const tolerance = rule.frequency === "weekly" ? 0 : DAY_MATCH_TOLERANCE;

		return rawOccurrences(
			rule,
			schedule.anchorDate,
			addDays(date, -tolerance),
			addDays(date, tolerance),
		).some(
			(occurrence) =>
				schedule.endAfterCount === null ||
				lifetime(schedule, schedule.endAfterCount, occurrence).includes(occurrence),
		);
	});
}

/**
 * Sure's `legacy_monthly?`: one monthly rule every month on a day other than
 * the last, never ending. Only it keeps the pre-rules date math.
 */
function isPlainMonthly(schedule: Schedule): boolean {
	const rule = schedule.rules[0]!;

	return (
		schedule.rules.length === 1 &&
		rule.frequency === "monthly" &&
		rule.interval === 1 &&
		rule.dayOfMonth !== LAST_DAY_OF_MONTH &&
		schedule.endAfterCount === null
	);
}

/** Sure's shim `next_occurrence_after`: a plain monthly series' day in the following month. */
export function nextOccurrenceAfter(schedule: Schedule, date: IsoDate): IsoDate | null {
	return isPlainMonthly(schedule)
		? withDay(addMonths(firstOfMonth(date), 1), schedule.expectedDayOfMonth)
		: firstOccurrenceAfter(schedule, date);
}

/**
 * Sure's shim `next_occurrence_from_today`: a plain monthly series' day this
 * month when still ahead, else next month's. Its quirk is kept: a day the
 * month lacks skips to the next month, so the 31st on 21 September is 31 October.
 */
export function nextOccurrenceFromToday(schedule: Schedule, today: IsoDate): IsoDate | null {
	if (!isPlainMonthly(schedule)) {
		return firstOccurrenceAfter(schedule, today);
	}

	const day = schedule.expectedDayOfMonth;
	const thisMonth = withDay(today, day);

	return day <= daysInMonth(yearOf(today), monthOf(today)) && thisMonth > today
		? thisMonth
		: withDay(addMonths(firstOfMonth(today), 1), day);
}

/**
 * A series' next date after a payment on `last`. A plain monthly series keeps
 * Spec 9.2's: the expected day nearest to one month after `last`, so a bill
 * due on the 1st paid on 31 August is due on 1 September; any other takes its
 * schedule's first occurrence after `last`.
 */
export function nextExpectedAfter(schedule: Schedule, last: IsoDate): IsoDate | null {
	if (!isPlainMonthly(schedule)) {
		return nextOccurrenceAfter(schedule, last);
	}

	const target = addMonths(last, 1);
	// The target's own month first, so it wins a tie.
	const candidates = [0, 1, -1].map((months) =>
		withDay(addMonths(firstOfMonth(target), months), schedule.expectedDayOfMonth),
	);

	return candidates.reduce((best, candidate) =>
		Math.abs(daysBetween(target, candidate)) < Math.abs(daysBetween(target, best))
			? candidate
			: best,
	);
}

/**
 * A series' first date that is `today` or later: for a plain monthly series
 * its day this month, else next month's, clamped, as Spec 9.2; for any other
 * its schedule's first occurrence from today.
 */
export function dueFrom(schedule: Schedule, today: IsoDate): IsoDate | null {
	if (!isPlainMonthly(schedule)) {
		return firstOccurrenceAfter(schedule, addDays(today, -1));
	}

	const thisMonth = withDay(today, schedule.expectedDayOfMonth);

	return thisMonth >= today
		? thisMonth
		: withDay(addMonths(firstOfMonth(today), 1), schedule.expectedDayOfMonth);
}

/** A series' one rule, monthly on `day`, as detection and « Ajouter aux récurrences » write it. */
export function monthlyOn(day: number): RecurrenceRule {
	return { frequency: "monthly", interval: 1, dayOfMonth: day };
}
