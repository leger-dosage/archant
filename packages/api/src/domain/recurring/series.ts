import type { IsoDate } from "../dates.ts";
import type { RecurringCandidate, SeriesKey } from "./identifier.ts";
import type { RecurrenceRule, Schedule } from "./schedule.ts";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { LAST_DAY_OF_MONTH } from "@archant/data/recurring";
import type { RecurringStatus } from "@archant/data/schema/recurring-transactions";

import { direction } from "../cash-flow.ts";
import { addDays, addMonths } from "../dates.ts";
import { roundedMean, sameKey, seriesKeyOf, withinBand } from "./identifier.ts";
import {
	DAYS_PER_YEAR,
	dueFrom,
	matchesDay,
	nextOccurrenceAfter,
	occurrencesPerYear,
} from "./schedule.ts";

// Sure's identifier reads three months back, its manual pass six.
const LOOKBACK_MONTHS = 3;
export const MANUAL_LOOKBACK_MONTHS = 6;
// Sure's `staleness_threshold_date`: two missed cycles of the series' own
// schedule, floored at two calendar months for a detected series and six for
// a manual one.
const STALE_MONTHS = 2;
const MANUAL_STALE_MONTHS = 6;
const STALE_CYCLES = 2;

/** What a series' schedule is built from. */
export type ScheduledSeries = {
	/** Never empty: detection, « Ajouter aux récurrences » and the owner each write one at least. */
	rules: readonly RecurrenceRule[];
	anchorDate: IsoDate | null;
	lastOccurrenceDate: IsoDate;
	endAfterCount: number | null;
	expectedDayOfMonth: number;
};

/** Sure's `Schedule.for`: the anchor is the anchor date, else the last occurrence date. */
export function scheduleOf(series: ScheduledSeries): Schedule {
	return {
		rules: series.rules,
		anchorDate: series.anchorDate ?? series.lastOccurrenceDate,
		endAfterCount: series.endAfterCount,
		expectedDayOfMonth: series.expectedDayOfMonth,
	};
}

/**
 * A series' next date after a payment on `last`, from its schedule. An
 * installment past its last payment keeps `last`.
 */
export function nextExpectedDate(series: ScheduledSeries, last: IsoDate): IsoDate {
	return nextOccurrenceAfter(scheduleOf(series), last) ?? last;
}

/** The first date of the series that is today or later: a manual item's next date, as Sure's. */
export function nextDateFrom(series: ScheduledSeries, today: IsoDate): IsoDate | null {
	return dueFrom(scheduleOf(series), today);
}

/**
 * A next date of the user's series, moved to the series' first date from
 * today on once passed; an installment past its last payment keeps it.
 */
export function currentNextDate(series: ScheduledSeries, next: IsoDate, today: IsoDate): IsoDate {
	return next < today ? (nextDateFrom(series, today) ?? next) : next;
}

/**
 * Sure's `sync_monthly_rule_day`: a plain monthly rule follows the day
 * detection found. `null` when there is nothing to move: several rules,
 * another cadence, the last day, or the same day.
 */
export function syncMonthlyRuleDay(
	rules: readonly RecurrenceRule[],
	day: number,
): RecurrenceRule[] | null {
	const rule = rules[0]!;

	return rules.length === 1 &&
		rule.frequency === "monthly" &&
		rule.interval === 1 &&
		rule.dayOfMonth !== LAST_DAY_OF_MONTH &&
		rule.dayOfMonth !== day
		? [{ ...rule, dayOfMonth: day }]
		: null;
}

/** Sure's variance band, signed like the series' amount. */
type AmountBand = {
	expectedAmountMin: MinorUnits | null;
	expectedAmountMax: MinorUnits | null;
	expectedAmountAvg: MinorUnits | null;
};

/** A stored series as the passes around detection read it. */
export type StoredSeries = SeriesKey &
	AmountBand &
	ScheduledSeries & {
		id: string;
		/** `null` pays from any account. */
		accountId: string | null;
		/** Set for a recurring transfer: the account its payments go into. */
		destinationAccountId: string | null;
		label: string;
		amount: MinorUnits;
		currency: string;
		status: RecurringStatus;
		manual: boolean;
		dedupScope: string;
		nextExpectedDate: IsoDate;
		occurrenceCount: number;
		/** Set when the owner changed the cadence: detection then moves no day and no rule. */
		schedulePinnedAt: number | null;
	};

/** Whether a series is the user's: its next date then never lies in the past. */
export function isKept(series: Pick<StoredSeries, "status" | "manual">): boolean {
	return series.status === "active" || series.manual;
}

/** How far back a series' occurrences are read: six months for the user's, as Sure's manual pass. */
function lookbackOf(series: Pick<StoredSeries, "status" | "manual">): number {
	return isKept(series) ? MANUAL_LOOKBACK_MONTHS : LOOKBACK_MONTHS;
}

const byDate = (a: RecurringCandidate, b: RecurringCandidate) =>
	a.date < b.date ? -1 : a.date > b.date ? 1 : 0;

/**
 * Sure's `manual_recurring_matches_entry?`: a transaction of the series'
 * account, or of any for a series without one, of its key and currency,
 * transfers left out, between half and twice its amount and on a day its
 * schedule matches. A recurring transfer takes, as Sure's
 * `transfer_matching_transactions`, the outflows of transfers from its
 * account into its destination instead of its key.
 */
function matches(series: StoredSeries, candidate: RecurringCandidate): boolean {
	return (
		(series.accountId === null || candidate.accountId === series.accountId) &&
		candidate.currency === series.currency &&
		(series.destinationAccountId === null
			? direction(candidate) !== "transfer" && sameKey(seriesKeyOf(candidate), series)
			: candidate.transfer?.intoAccountId === series.destinationAccountId) &&
		withinBand(candidate.amount, series.amount) &&
		matchesDay(scheduleOf(series), candidate.date)
	);
}

/**
 * The transactions `matches` keeps, from `lookbackOf` months back. Oldest
 * first, same days in the caller's order.
 */
export function occurrencesOf(
	series: StoredSeries,
	candidates: readonly RecurringCandidate[],
	today: IsoDate,
): RecurringCandidate[] {
	const from = addMonths(today, -lookbackOf(series));

	return candidates
		.filter((candidate) => candidate.date >= from && matches(series, candidate))
		.toSorted(byDate);
}

export type SeriesRefresh = {
	label: string;
	lastOccurrenceDate: IsoDate;
	nextExpectedDate: IsoDate;
	occurrenceCount: number;
	/** Set for an active manual series, as Sure's manual pass; `null` leaves the band. */
	band: AmountBand | null;
};

/** The signed band of `amounts`, never empty. */
function bandOf(amounts: readonly MinorUnits[]): AmountBand {
	return {
		expectedAmountMin: toMinorUnits(Math.min(...amounts)),
		expectedAmountMax: toMinorUnits(Math.max(...amounts)),
		expectedAmountAvg: roundedMean(
			toMinorUnits(amounts.reduce((sum, amount) => sum + amount, 0)),
			amounts.length,
		),
	};
}

/**
 * Story 11.8's refresh, run on every series no pattern updated and not
 * ended: count, latest date and label come from its current transactions, and
 * an active manual series takes its band from them too, as Sure's
 * `update_manual_recurring_transactions`, and the next date follows the
 * series' schedule. A manual series with none left in its window keeps its
 * last date and count, as Sure's `next if matching_entries.empty?`, so a bill
 * declared ahead of its first payment stays as declared, its next date moved
 * from today on once passed. A suggestion with none left stays as it is,
 * since neither Sure's identifier nor its cleaner touches one. Any other
 * keeps its last date with a count of 0.
 */
export function refreshSeries(
	series: StoredSeries,
	candidates: readonly RecurringCandidate[],
	today: IsoDate,
): SeriesRefresh {
	const found = occurrencesOf(series, candidates, today);
	const latest = found.at(-1);
	const current = (next: IsoDate) => (isKept(series) ? currentNextDate(series, next, today) : next);

	if (latest === undefined) {
		if (series.manual || series.status === "suggested") {
			return {
				label: series.label,
				lastOccurrenceDate: series.lastOccurrenceDate,
				nextExpectedDate: current(series.nextExpectedDate),
				occurrenceCount: series.occurrenceCount,
				band: null,
			};
		}

		return {
			label: series.label,
			lastOccurrenceDate: series.lastOccurrenceDate,
			nextExpectedDate: current(series.nextExpectedDate),
			occurrenceCount: 0,
			band: null,
		};
	}

	return {
		label: latest.label,
		lastOccurrenceDate: latest.date,
		nextExpectedDate: current(nextExpectedDate(series, latest.date)),
		occurrenceCount: found.length,
		band:
			series.manual && series.status === "active"
				? bandOf(found.map((candidate) => candidate.amount))
				: null,
	};
}

/**
 * Sure's `staleness_threshold_date`: the earlier of two calendar months back,
 * six for a manual series, and two of the series' own cycles back, so a
 * quarterly or a yearly bill survives the gap between two payments.
 */
export function staleBefore(
	series: Pick<StoredSeries, "manual"> & ScheduledSeries,
	today: IsoDate,
): IsoDate {
	const floor = addMonths(today, -(series.manual ? MANUAL_STALE_MONTHS : STALE_MONTHS));
	const cycleDays = Math.ceil(
		(STALE_CYCLES * DAYS_PER_YEAR) / occurrencesPerYear(scheduleOf(series)),
	);
	const cycles = addDays(today, -cycleDays);

	return floor < cycles ? floor : cycles;
}

/** What the cleaner writes. */
export type CleanerSteps = { inactive: string[] };

/**
 * Sure's `Cleaner#cleanup_stale_transactions`, run by « Nettoyer les
 * obsolètes » alone: an `active` series last seen before `staleBefore`
 * becomes `inactive`, unless one of its transactions since passes `matches`,
 * a recurring transfer's outflows included as Sure's since #1590. Any other
 * series is left as it is, a suggestion with no transaction left included.
 * Sure's removal of old inactive series has no port: a household keeps its
 * history.
 */
export function cleanerSteps(
	stored: readonly StoredSeries[],
	candidates: readonly RecurringCandidate[],
	today: IsoDate,
): CleanerSteps {
	const inactive = stored
		.filter((series) => {
			if (series.status !== "active") {
				return false;
			}

			const threshold = staleBefore(series, today);

			return (
				series.lastOccurrenceDate < threshold &&
				!candidates.some((candidate) => candidate.date >= threshold && matches(series, candidate))
			);
		})
		.map((series) => series.id);

	return { inactive };
}
