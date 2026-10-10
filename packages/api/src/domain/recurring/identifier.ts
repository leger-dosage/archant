import type { CashFlowTransaction } from "../cash-flow.ts";
import type { IsoDate } from "../dates.ts";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";

import { recurringDirection } from "../cash-flow.ts";
import { addDays, addMonths } from "../dates.ts";
import { normalizeLabel } from "../normalize-label.ts";
import { DAY_MATCH_TOLERANCE } from "./schedule.ts";

/**
 * What detection reads of a transaction; excluded rows count, as in Sure. The
 * caller leaves out split parents and investment accounts.
 */
export type RecurringCandidate = CashFlowTransaction & {
	accountId: string;
	date: IsoDate;
	currency: string;
	label: string;
	merchantId: string | null;
};

/**
 * What identifies a series besides its account and currency: its merchant, or
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

export const sameKey = (a: SeriesKey, b: SeriesKey) =>
	a.merchantId === b.merchantId && a.labelKey === b.labelKey;

/** One detected pattern: a cluster of one group's amounts that recurs on one day. */
export type RecurringPattern<Row extends RecurringCandidate = RecurringCandidate> = SeriesKey & {
	accountId: string;
	/** The latest row's raw label. */
	label: string;
	/** The latest row's amount: the current price. */
	amount: MinorUnits;
	/** The cluster's signed band: for an expense the minimum is the largest magnitude. */
	expectedAmountMin: MinorUnits;
	expectedAmountMax: MinorUnits;
	expectedAmountAvg: MinorUnits;
	/** The cluster's sum, so a claim compares with the exact mean, as Sure's `BigDecimal`. */
	amountTotal: MinorUnits;
	currency: string;
	expectedDayOfMonth: number;
	lastOccurrenceDate: IsoDate;
	occurrenceCount: number;
	/** The cluster's rows, in cluster order, the latest last on its day. */
	rows: Row[];
	/** The latest row, the last of the latest day: its label is the one shown. */
	latest: Row;
};

// Sure's thresholds (`RecurringTransaction::Identifier` at `14638a701`).
const LOOKBACK_MONTHS = 3;
const MIN_OCCURRENCES = 3;
const STALE_AFTER_DAYS = 45;
const CIRCLE = 31;
// Sure's `DEFAULT_TOLERANCE_PCT` of 7.5, as a fraction of a thousand so the
// test stays on integers.
const TOLERANCE_PER_THOUSAND = 75;
// Sure's `AMOUNT_VARIANCE_RATIO`: a payment may halve or double and stay the same.
const VARIANCE_RATIO = 2;

/** Days of the month apart on Sure's 31-day circle: the 30th and the 1st are 2 apart. */
export function dayDistance(a: number, b: number): number {
	const gap = Math.abs(a - b);

	return Math.min(gap, CIRCLE - gap);
}

const dayOf = (date: IsoDate) => Number(date.slice(8, 10));

const modulo = (value: number) => ((value % CIRCLE) + CIRCLE) % CIRCLE;

/**
 * Sure's `calculate_expected_day`: the 0-based days are rotated by the lowest
 * pivot giving the smallest span, so 30, 1 and 2 read as contiguous, and the
 * median of that arrangement, two middle days averaged and rounded half up, is
 * mapped back into 1 to 31.
 */
export function expectedDay(days: readonly number[]): number {
	if (days.length === 1) {
		return days[0]!;
	}

	const zeroBased = days.map((day) => day - 1);
	let bestPivot = 0;
	let minSpan = Number.POSITIVE_INFINITY;

	for (let pivot = 0; pivot < CIRCLE; pivot += 1) {
		const rotated = zeroBased.map((day) => modulo(day - pivot));
		const span = Math.max(...rotated) - Math.min(...rotated);

		if (span < minSpan) {
			minSpan = span;
			bestPivot = pivot;
		}
	}

	const rotated = zeroBased.map((day) => modulo(day - bestPivot)).toSorted((a, b) => a - b);
	const middle = Math.floor(rotated.length / 2);
	// Never negative, so `Math.round` rounds half away from zero, as Ruby's `round`.
	const median =
		rotated.length % 2 === 1
			? rotated[middle]!
			: Math.round((rotated[middle - 1]! + rotated[middle]!) / 2);

	return modulo(median + bestPivot) + 1;
}

/**
 * Sure's `within_tolerance?` against a mean of `count` amounts summing to
 * `total`: `|amount − total / count| ≤ 7.5 % × |total / count|`, multiplied
 * through so no division rounds.
 */
export function withinMeanTolerance(total: MinorUnits, count: number, amount: MinorUnits): boolean {
	return 1000 * Math.abs(amount * count - total) <= TOLERANCE_PER_THOUSAND * Math.abs(total);
}

/**
 * Sure's `amount_within_variance_band?`: between half and twice `anchor`,
 * both included, on the anchor's side of zero. A zero anchor takes only zero.
 */
export function withinBand(amount: MinorUnits, anchor: MinorUnits): boolean {
	if (anchor === 0) {
		return amount === 0;
	}

	return (
		Math.sign(amount) === Math.sign(anchor) &&
		VARIANCE_RATIO * Math.abs(amount) >= Math.abs(anchor) &&
		Math.abs(amount) <= VARIANCE_RATIO * Math.abs(anchor)
	);
}

/** `total / count` rounded half away from zero, as Sure's `BigDecimal#round`. */
export function roundedMean(total: MinorUnits, count: number): MinorUnits {
	const magnitude = Math.floor((2 * Math.abs(total) + count) / (2 * count));

	return toMinorUnits(total < 0 ? -magnitude : magnitude);
}

/**
 * Sure's `cluster_by_amount`: sorted by amount, a row joins the last cluster
 * while it sits within 7.5 % of that cluster's running mean, else starts one.
 * Sure stores an expense positive and Archant negative (AD-5), so the rows sort
 * by the negated amount to form Sure's clusters in Sure's order.
 */
export function clusterByAmount<Row extends { amount: MinorUnits }>(rows: readonly Row[]): Row[][] {
	const clusters: { rows: Row[]; total: MinorUnits }[] = [];

	for (const row of rows.toSorted((a, b) => b.amount - a.amount)) {
		const current = clusters.at(-1);

		if (
			current !== undefined &&
			withinMeanTolerance(current.total, current.rows.length, row.amount)
		) {
			current.rows.push(row);
			current.total = toMinorUnits(current.total + row.amount);
		} else {
			clusters.push({ rows: [row], total: row.amount });
		}
	}

	return clusters.map((cluster) => cluster.rows);
}

/**
 * Sure's `RecurringTransaction::Identifier#collect_patterns`: transactions of
 * the last three months, transfers left out, grouped by account, merchant or
 * else normalised label, and currency, then clustered by amount. A cluster of
 * `minOccurrences` or more, three for detection and two for the declare
 * dialog's starting points, as Sure's `collect_patterns`, whose latest row is
 * at most 45 days old and whose every day lies within 2 of the expected day,
 * on Sure's 31-day circle, is a pattern. Patterns come group by group, each
 * group's in ascending amount as Sure reads it.
 */
export function detectRecurring<Row extends RecurringCandidate>(
	candidates: readonly Row[],
	today: IsoDate,
	minOccurrences = MIN_OCCURRENCES,
): RecurringPattern<Row>[] {
	const from = addMonths(today, -LOOKBACK_MONTHS);
	const freshFrom = addDays(today, -STALE_AFTER_DAYS);
	const groups = new Map<string, Row[]>();

	for (const candidate of candidates) {
		if (candidate.date < from || recurringDirection(candidate) === "transfer") {
			continue;
		}

		const key = seriesKeyOf(candidate);
		const groupKey = JSON.stringify([
			candidate.accountId,
			key.merchantId,
			key.labelKey,
			candidate.currency,
		]);
		const group = groups.get(groupKey);

		if (group === undefined) {
			groups.set(groupKey, [candidate]);
		} else {
			group.push(candidate);
		}
	}

	return [...groups.values()].flatMap((group) =>
		clusterByAmount(group).flatMap((cluster): RecurringPattern<Row>[] => {
			// The last of the latest day wins, so its label is the one shown.
			const latest = cluster.reduce((best, row) => (row.date >= best.date ? row : best));
			const days = cluster.map((row) => dayOf(row.date));
			const day = expectedDay(days);

			if (
				cluster.length < minOccurrences ||
				latest.date < freshFrom ||
				!days.every((candidate) => dayDistance(candidate, day) <= DAY_MATCH_TOLERANCE)
			) {
				return [];
			}

			const amounts = cluster.map((row) => row.amount);
			const total = toMinorUnits(amounts.reduce((sum, amount) => sum + amount, 0));

			return [
				{
					...seriesKeyOf(latest),
					accountId: latest.accountId,
					label: latest.label,
					amount: latest.amount,
					expectedAmountMin: toMinorUnits(Math.min(...amounts)),
					expectedAmountMax: toMinorUnits(Math.max(...amounts)),
					expectedAmountAvg: roundedMean(total, cluster.length),
					amountTotal: total,
					currency: latest.currency,
					expectedDayOfMonth: day,
					lastOccurrenceDate: latest.date,
					occurrenceCount: cluster.length,
					rows: cluster,
					latest,
				},
			];
		}),
	);
}

/** What a claim reads of a stored series. */
export type ClaimableSeries = SeriesKey & {
	accountId: string;
	currency: string;
	amount: MinorUnits;
};

/**
 * Sure's `nearest_within_tolerance`: among the series of the pattern's
 * account, key and currency, whatever their status, manual ones included, the
 * one whose amount lies within 7.5 % of the pattern's mean and nearest to it.
 * The first wins a tie, as Ruby's `min_by`.
 */
export function claimOf<Series extends ClaimableSeries>(
	pattern: Pick<
		RecurringPattern,
		"accountId" | "currency" | "merchantId" | "labelKey" | "occurrenceCount" | "amountTotal"
	>,
	stored: readonly Series[],
): Series | undefined {
	const count = pattern.occurrenceCount;
	const total = pattern.amountTotal;
	let best: Series | undefined;

	for (const series of stored) {
		if (
			series.accountId !== pattern.accountId ||
			series.currency !== pattern.currency ||
			!sameKey(series, pattern) ||
			!withinMeanTolerance(total, count, series.amount)
		) {
			continue;
		}

		if (
			best === undefined ||
			Math.abs(series.amount * count - total) < Math.abs(best.amount * count - total)
		) {
			best = series;
		}
	}

	return best;
}
