import type { IsoDate } from "../dates.ts";
import type { RecurringCandidate, SeriesKey } from "./identifier.ts";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import type { RecurringStatus } from "@archant/data/schema/recurring-transactions";

import { direction } from "../cash-flow.ts";
import { addDays, addMonths, daysBetween, withDay } from "../dates.ts";
import { onExpectedDay, roundedMean, sameKey, seriesKeyOf, withinBand } from "./identifier.ts";

// Sure's identifier reads three months back, its manual pass six.
const LOOKBACK_MONTHS = 3;
export const MANUAL_LOOKBACK_MONTHS = 6;
// Sure's `staleness_threshold_date`: two missed cycles, floored at two
// calendar months for a detected series and six for a manual one.
const STALE_MONTHS = 2;
const MANUAL_STALE_MONTHS = 6;
// Two monthly cycles, `ceil(2 × 365.25 / 12)`: Sure's cycle floor for the
// only cadence Archant detects.
const STALE_CYCLE_DAYS = 61;

/**
 * The date on the expected day nearest to one month after the latest row.
 * Sure takes the expected day of the following month, so a bill due on the
 * 1st that came on 31 August reads as due on 1 September, the day after.
 */
export function nextExpectedDate(lastDate: IsoDate, day: number): IsoDate {
	const target = addMonths(lastDate, 1);
	const firstOfMonth = `${target.slice(0, 8)}01`;
	// The target's own month first, so it wins a tie.
	const candidates = [0, 1, -1].map((months) => withDay(addMonths(firstOfMonth, months), day));

	return candidates.reduce((best, candidate) =>
		Math.abs(daysBetween(target, candidate)) < Math.abs(daysBetween(target, best))
			? candidate
			: best,
	);
}

/** The first date on the expected day that is today or later: a manual item's next date, as Sure's. */
export function nextDateFrom(today: IsoDate, day: number): IsoDate {
	const thisMonth = withDay(today, day);

	return thisMonth >= today ? thisMonth : withDay(addMonths(`${today.slice(0, 8)}01`, 1), day);
}

/** A next date of the user's series, moved to the expected day from today on once passed. */
export function currentNextDate(next: IsoDate, day: number, today: IsoDate): IsoDate {
	return next < today ? nextDateFrom(today, day) : next;
}

/** Sure's variance band, signed like the series' amount. */
type AmountBand = {
	expectedAmountMin: MinorUnits | null;
	expectedAmountMax: MinorUnits | null;
	expectedAmountAvg: MinorUnits | null;
};

/** A stored series as the passes around detection read it. */
export type StoredSeries = SeriesKey &
	AmountBand & {
		id: string;
		accountId: string;
		label: string;
		amount: MinorUnits;
		currency: string;
		status: RecurringStatus;
		manual: boolean;
		dedupScope: string;
		expectedDayOfMonth: number;
		lastOccurrenceDate: IsoDate;
		nextExpectedDate: IsoDate;
		occurrenceCount: number;
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
 * amount and within 2 days of its expected day.
 */
function matches(series: StoredSeries, candidate: RecurringCandidate): boolean {
	return (
		candidate.accountId === series.accountId &&
		candidate.currency === series.currency &&
		direction(candidate) !== "transfer" &&
		withinBand(candidate.amount, series.amount) &&
		sameKey(seriesKeyOf(candidate), series) &&
		onExpectedDay(candidate.date, series.expectedDayOfMonth)
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
 * would come back as a twin. The transactions of its account and currency on
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

		// Deleted earlier as the holder of another row's new key.
		if (row === undefined) {
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
 * `update_manual_recurring_transactions`. A `suggested` series with none left
 * in its window goes, to a revert, a delete or time: a suggestion never
 * becomes inactive. Any other keeps its last date with a count of 0.
 */
export function refreshSeries(
	series: StoredSeries,
	candidates: readonly RecurringCandidate[],
	today: IsoDate,
): SeriesRefresh {
	const found = occurrencesOf(series, candidates, today);
	const latest = found.at(-1);
	const day = series.expectedDayOfMonth;
	const current = (next: IsoDate) => (isKept(series) ? currentNextDate(next, day, today) : next);

	if (latest === undefined) {
		if (series.status === "suggested") {
			return { kind: "delete" };
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
		nextExpectedDate: current(nextExpectedDate(latest.date, day)),
		occurrenceCount: found.length,
		band:
			series.manual && series.status === "active"
				? bandOf(found.map((candidate) => candidate.amount))
				: null,
	};
}

/**
 * Sure's `staleness_threshold_date` for a monthly series: the earlier of two
 * calendar months back, six for a manual series, and two monthly cycles back.
 */
export function staleBefore(series: Pick<StoredSeries, "manual">, today: IsoDate): IsoDate {
	const floor = addMonths(today, -(series.manual ? MANUAL_STALE_MONTHS : STALE_MONTHS));
	const cycles = addDays(today, -STALE_CYCLE_DAYS);

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
