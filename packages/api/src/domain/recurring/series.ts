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
	nextExpectedAfter,
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
	return nextExpectedAfter(scheduleOf(series), last) ?? last;
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
		accountId: string;
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
 * account, key and currency, transfers left out, between half and twice its
 * amount and on a day its schedule matches.
 */
function matches(series: StoredSeries, candidate: RecurringCandidate): boolean {
	return (
		candidate.accountId === series.accountId &&
		candidate.currency === series.currency &&
		direction(candidate) !== "transfer" &&
		withinBand(candidate.amount, series.amount) &&
		sameKey(seriesKeyOf(candidate), series) &&
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

/** One write of `rekey`, applied in order: a move may need a delete before it. */
export type RekeyStep =
	| { kind: "delete"; id: string }
	| ({ kind: "move"; id: string; label: string } & SeriesKey);

/**
 * A series whose latest transaction no longer carries its key follows that
 * transaction: renaming the rows or setting their merchant must not leave a
 * twin behind. It moves only once no row of its refresh window keeps the old
 * key, or renaming just the latest row would move it and the older rows
 * would come back as a twin. A bill declared with no payment yet has no row
 * on its last date, its due date, so it never moves onto whatever was bought
 * that day. The transactions of its account and currency on
 * its last date, between half and twice its amount, must carry exactly one
 * other key; two identical payments renamed apart on one day leave it where it
 * is rather than guess. A `suggested` row already on the target key, amount,
 * currency and dedup scope gives way; any other holder stays and the moving
 * row goes, since the user settled that one. Returns the steps and the series
 * as they stand after them.
 */
export function rekey(
	stored: readonly StoredSeries[],
	candidates: readonly RecurringCandidate[],
	today: IsoDate,
): { steps: RekeyStep[]; stored: StoredSeries[] } {
	const spent = candidates.filter((candidate) => direction(candidate) !== "transfer");
	const steps: RekeyStep[] = [];
	let current = [...stored];

	for (const { id } of stored) {
		const row = current.find((series) => series.id === id);

		// Deleted earlier as the holder of another row's new key, or a bill
		// declared with no payment yet.
		if (row === undefined || row.occurrenceCount === 0) {
			continue;
		}

		const sameDay = spent.filter(
			(candidate) =>
				candidate.accountId === row.accountId &&
				withinBand(candidate.amount, row.amount) &&
				candidate.date === row.lastOccurrenceDate,
		);

		if (
			sameDay.some((candidate) => sameKey(seriesKeyOf(candidate), row)) ||
			occurrencesOf(row, candidates, today).length > 0
		) {
			continue;
		}

		// The last one of a key wins its label, as detection's latest row does.
		const targets = new Map(
			sameDay
				.filter((candidate) => candidate.currency === row.currency)
				.map((candidate) => [JSON.stringify(seriesKeyOf(candidate)), candidate]),
		);
		if (targets.size !== 1) {
			continue;
		}

		const target = [...targets.values()][0]!;
		const key = seriesKeyOf(target);
		// The row the unique index would refuse the move beside.
		const holder = current.find(
			(series) =>
				series.accountId === row.accountId &&
				series.amount === row.amount &&
				series.currency === row.currency &&
				series.dedupScope === row.dedupScope &&
				sameKey(series, key),
		);

		if (holder !== undefined && holder.status !== "suggested") {
			steps.push({ kind: "delete", id: row.id });
			current = current.filter((series) => series.id !== row.id);
			continue;
		}

		if (holder !== undefined) {
			steps.push({ kind: "delete", id: holder.id });
			current = current.filter((series) => series.id !== holder.id);
		}

		steps.push({ kind: "move", id: row.id, ...key, label: target.label });
		current = current.map((series) =>
			series.id === row.id ? { ...series, ...key, label: target.label } : series,
		);
	}

	return { steps, stored: current };
}

export type SeriesRefresh =
	| { kind: "delete" }
	| {
			kind: "update";
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
 * series' schedule. A `suggested` series with none left in its window goes,
 * to a revert, a delete or time: a suggestion never becomes inactive. A
 * manual one keeps its last date and count, as Sure's `next if
 * matching_entries.empty?`, so a bill declared ahead of its first payment
 * stays as declared, its next date moved from today on once passed. Any other
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
		if (series.status === "suggested") {
			return { kind: "delete" };
		}

		if (series.manual) {
			return {
				kind: "update",
				label: series.label,
				lastOccurrenceDate: series.lastOccurrenceDate,
				nextExpectedDate: current(series.nextExpectedDate),
				occurrenceCount: series.occurrenceCount,
				band: null,
			};
		}

		return {
			kind: "update",
			label: series.label,
			lastOccurrenceDate: series.lastOccurrenceDate,
			nextExpectedDate: current(series.nextExpectedDate),
			occurrenceCount: 0,
			band: null,
		};
	}

	return {
		kind: "update",
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
export type CleanerSteps = { inactive: string[]; deleted: string[] };

/**
 * Sure's `Cleaner#cleanup_stale_transactions`: an `active` series last seen
 * before `staleBefore` becomes `inactive`, unless one of its transactions
 * since passes `matches`. A suggestion never becomes inactive; one with no
 * transaction left in its window is deleted instead. Sure's removal of old
 * inactive series has no port: a household keeps its history.
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
	const deleted = stored
		.filter(
			(series) =>
				series.status === "suggested" && occurrencesOf(series, candidates, today).length === 0,
		)
		.map((series) => series.id);

	return { inactive, deleted };
}
