import type { CashFlowTransaction } from "./cash-flow.ts";
import type { IsoDate } from "./dates.ts";

import type { MinorUnits } from "@archant/data/money";
import type { RecurringStatus } from "@archant/data/schema/recurring-transactions";

import { direction } from "./cash-flow.ts";
import { addDays, addMonths, daysBetween, withDay } from "./dates.ts";
import { normalizeLabel } from "./normalize-label.ts";

/** What detection reads of a transaction; excluded rows count, as in Sure. */
export type RecurringCandidate = CashFlowTransaction & {
	accountId: string;
	date: IsoDate;
	currency: string;
	label: string;
	merchantId: string | null;
};

/**
 * One detected pattern. Exactly one of `merchantId` and `labelKey` is set:
 * rows with a merchant group by it, the others by their normalised label.
 */
export type RecurringPattern = {
	accountId: string;
	merchantId: string | null;
	labelKey: string | null;
	/** The latest row's raw label. */
	label: string;
	amount: MinorUnits;
	currency: string;
	expectedDayOfMonth: number;
	lastOccurrenceDate: IsoDate;
	nextExpectedDate: IsoDate;
	occurrenceCount: number;
};

// Sure's thresholds (`RecurringTransaction::Identifier`).
export const LOOKBACK_MONTHS = 3;
// Sure's `update_manual_recurring_transactions` looks six months back.
export const MANUAL_LOOKBACK_MONTHS = 6;
const MIN_OCCURRENCES = 3;
const STALE_AFTER_DAYS = 45;
const MAX_DAY_SPREAD = 5;
const CIRCLE = 31;
// Sure's `cleanup_stale_for`: no occurrence for two expected periods.
const INACTIVE_AFTER_MONTHS = 2;

/** Days of the month apart on Sure's 31-day circle: the 30th and the 1st are 2 apart. */
export function dayDistance(a: number, b: number): number {
	const gap = Math.abs(a - b);

	return Math.min(gap, CIRCLE - gap);
}

/**
 * Sure's `calculate_expected_day`: the days are rotated around the circle to
 * the arrangement of least span, so 30, 1 and 2 read as 30, 32 and 33, and the
 * median of that arrangement, two middle days averaged and rounded, is folded
 * back into 1 to 31.
 */
export function expectedDay(days: readonly number[]): number {
	const sorted = days.toSorted((a, b) => a - b);
	let best = sorted;

	for (let pivot = 1; pivot < sorted.length; pivot += 1) {
		const rotated = [...sorted.slice(pivot), ...sorted.slice(0, pivot).map((day) => day + CIRCLE)];

		if (rotated.at(-1)! - rotated[0]! < best.at(-1)! - best[0]!) {
			best = rotated;
		}
	}

	const middle = Math.floor(best.length / 2);
	const median =
		best.length % 2 === 1 ? best[middle]! : Math.round((best[middle - 1]! + best[middle]!) / 2);

	return ((median - 1) % CIRCLE) + 1;
}

/**
 * Whether every pair of days is within 5 of each other on the circle. Sure
 * checks the standard deviation of distances to the median instead, which
 * lets 5, 15 and 15 through against its own « within ~5 days » comment.
 */
function clusters(days: readonly number[]): boolean {
	return days.every((a, index) =>
		days.slice(index + 1).every((b) => dayDistance(a, b) <= MAX_DAY_SPREAD),
	);
}

/**
 * Sure's `RecurringTransaction::Identifier`: transactions of the last three
 * months, transfers left out, grouped by account, merchant or else normalised
 * label, and exact signed amount. A group of three or more whose latest row is
 * at most 45 days old and whose days of the month cluster is a pattern.
 */
export function detectRecurring(
	candidates: readonly RecurringCandidate[],
	today: IsoDate,
): RecurringPattern[] {
	const from = addMonths(today, -LOOKBACK_MONTHS);
	const freshFrom = addDays(today, -STALE_AFTER_DAYS);
	const groups = new Map<string, RecurringCandidate[]>();

	for (const candidate of candidates) {
		if (candidate.date < from || direction(candidate) === "transfer") {
			continue;
		}

		const key = JSON.stringify([
			candidate.accountId,
			candidate.merchantId === null ? "label" : "merchant",
			candidate.merchantId ?? normalizeLabel(candidate.label),
			candidate.amount,
		]);
		const group = groups.get(key);

		if (group === undefined) {
			groups.set(key, [candidate]);
		} else {
			group.push(candidate);
		}
	}

	const patterns: RecurringPattern[] = [];

	for (const group of groups.values()) {
		// Stable: rows of the same day keep the caller's order, the last one wins.
		const rows = group.toSorted((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
		const latest = rows.at(-1)!;
		const days = rows.map((row) => Number(row.date.slice(8, 10)));

		if (rows.length < MIN_OCCURRENCES || latest.date < freshFrom || !clusters(days)) {
			continue;
		}

		const day = expectedDay(days);

		patterns.push({
			accountId: latest.accountId,
			merchantId: latest.merchantId,
			labelKey: latest.merchantId === null ? normalizeLabel(latest.label) : null,
			label: latest.label,
			amount: latest.amount,
			currency: latest.currency,
			expectedDayOfMonth: day,
			lastOccurrenceDate: latest.date,
			nextExpectedDate: nextExpectedDate(latest.date, day),
			occurrenceCount: rows.length,
		});
	}

	return patterns;
}

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

/** Whether a pattern last seen on `lastDate` has missed more than two expected periods. */
export function isStale(lastDate: IsoDate, today: IsoDate): boolean {
	return lastDate < addMonths(today, -INACTIVE_AFTER_MONTHS);
}

/**
 * What identifies a series besides its account and amount: its merchant, or
 * else its normalised label, never both.
 */
export type SeriesKey = { merchantId: string | null; labelKey: string | null };

export function seriesKeyOf(
	candidate: Pick<RecurringCandidate, "merchantId" | "label">,
): SeriesKey {
	return candidate.merchantId === null
		? { merchantId: null, labelKey: normalizeLabel(candidate.label) }
		: { merchantId: candidate.merchantId, labelKey: null };
}

const sameKey = (a: SeriesKey, b: SeriesKey) =>
	a.merchantId === b.merchantId && a.labelKey === b.labelKey;

/** A stored series as the passes around detection read it. */
export type StoredSeries = SeriesKey & {
	id: string;
	accountId: string;
	label: string;
	amount: MinorUnits;
	currency: string;
	status: RecurringStatus;
	manual: boolean;
	expectedDayOfMonth: number;
	lastOccurrenceDate: IsoDate;
	nextExpectedDate: IsoDate;
	occurrenceCount: number;
};

/** One write of `rekey`, applied in order: a move may need a delete before it. */
export type RekeyStep =
	| { kind: "delete"; id: string }
	| ({ kind: "move"; id: string; label: string } & SeriesKey);

/**
 * A series whose latest transaction no longer carries its key follows that
 * transaction: renaming the rows or setting their merchant must not leave a
 * twin behind. It moves only once no row of its refresh window keeps the old
 * key, or renaming just the latest row would move it and the older rows
 * would come back as a twin. The transactions of its account, amount and
 * currency on its last date must carry exactly one other key; two identical
 * payments renamed apart on one day leave it where it is rather than guess. A `detected` row
 * already on the target key gives way; any other holder stays and the moving
 * row goes, since the user settled that one. Returns the steps and the
 * series as they stand after them.
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
				candidate.amount === row.amount &&
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
		const holder = current.find(
			(series) =>
				series.accountId === row.accountId && series.amount === row.amount && sameKey(series, key),
		);

		if (holder !== undefined && holder.status !== "detected") {
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

/** Whether a series is the user's: its next date then never lies in the past. */
export function isKept(series: Pick<StoredSeries, "status" | "manual">): boolean {
	return series.status === "confirmed" || series.manual;
}

/** How far back a series' occurrences are read: six months for the user's, as Sure's manual pass. */
export function lookbackOf(series: Pick<StoredSeries, "status" | "manual">): number {
	return isKept(series) ? MANUAL_LOOKBACK_MONTHS : LOOKBACK_MONTHS;
}

/**
 * Sure's `find_matching_transaction_entries`: the transactions of the
 * series' account, key, amount and currency, transfers left out, within 5
 * days of its expected day, from `lookbackOf` months back. Oldest first.
 */
export function occurrencesOf(
	series: StoredSeries,
	candidates: readonly RecurringCandidate[],
	today: IsoDate,
): RecurringCandidate[] {
	const from = addMonths(today, -lookbackOf(series));

	return candidates
		.filter(
			(candidate) =>
				candidate.accountId === series.accountId &&
				candidate.amount === series.amount &&
				candidate.currency === series.currency &&
				candidate.date >= from &&
				direction(candidate) !== "transfer" &&
				sameKey(seriesKeyOf(candidate), series) &&
				dayDistance(Number(candidate.date.slice(8, 10)), series.expectedDayOfMonth) <=
					MAX_DAY_SPREAD,
		)
		.toSorted((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** A next date of the user's series, moved to the expected day from today on once passed. */
export function currentNextDate(next: IsoDate, day: number, today: IsoDate): IsoDate {
	return next < today ? nextDateFrom(today, day) : next;
}

export type SeriesRefresh =
	| { kind: "delete" }
	| {
			kind: "update";
			label: string;
			lastOccurrenceDate: IsoDate;
			nextExpectedDate: IsoDate;
			occurrenceCount: number;
	  };

/**
 * Sure's `update_manual_recurring_transactions`, run on every series no
 * pattern updated: count, latest date and label come from its current
 * transactions. A `detected` series whose last date lies inside the window
 * yet has none left lost its rows, to a revert or a delete, and goes; any
 * other keeps its last date with a count of 0.
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
		if (
			series.status === "detected" &&
			series.lastOccurrenceDate >= addMonths(today, -lookbackOf(series))
		) {
			return { kind: "delete" };
		}

		return {
			kind: "update",
			label: series.label,
			lastOccurrenceDate: series.lastOccurrenceDate,
			nextExpectedDate: current(series.nextExpectedDate),
			occurrenceCount: 0,
		};
	}

	return {
		kind: "update",
		label: latest.label,
		lastOccurrenceDate: latest.date,
		nextExpectedDate: current(nextExpectedDate(latest.date, day)),
		occurrenceCount: found.length,
	};
}
