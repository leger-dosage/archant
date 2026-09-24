import type { CashFlowTransaction } from "./cash-flow.ts";
import type { IsoDate } from "./dates.ts";

import type { MinorUnits } from "@archant/data/money";

import { direction } from "./cash-flow.ts";
import { addDays, addMonths, withDay } from "./dates.ts";
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
const MIN_OCCURRENCES = 3;
const STALE_AFTER_DAYS = 45;
const MAX_DAY_SPREAD = 5;
const CIRCLE = 31;

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
			nextExpectedDate: withDay(addMonths(latest.date, 1), day),
			occurrenceCount: rows.length,
		});
	}

	return patterns;
}
