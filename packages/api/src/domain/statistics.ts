import type { CashFlowRow } from "./cash-flow.ts";
import type { IsoMonth } from "./dates.ts";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";

import { sideOf } from "./cash-flow.ts";

/** A counted row as `cashFlowByMonth` groups it: a category's side of a calendar month. */
export type MonthlyCashFlowRow = CashFlowRow & { month: IsoMonth };

/** A side's monthly figures, positive; `null` when no month holds a line of that side. */
type SideStats = { median: MinorUnits | null; average: MinorUnits | null };

/** Sure's `StatRow`s of one key: its income and its expense side. */
export type Stats = { income: SideStats; expense: SideStats };

/** The median of minor-unit amounts, rounded to the minor unit; `null` for none. */
export function medianOf(values: readonly MinorUnits[]): MinorUnits | null {
	if (values.length === 0) {
		return null;
	}

	const sorted = values.toSorted((a, b) => a - b);
	// The middle value of an odd count, the two middle values of an even one.
	const middle = sorted.slice((sorted.length - 1) >> 1, (sorted.length >> 1) + 1);

	return toMinorUnits(Math.round(middle.reduce((sum, value) => sum + value, 0) / middle.length));
}

/** The mean of minor-unit amounts, rounded to the minor unit; `null` for none. */
export function averageOf(values: readonly MinorUnits[]): MinorUnits | null {
	if (values.length === 0) {
		return null;
	}

	return toMinorUnits(Math.round(values.reduce((sum, value) => sum + value, 0) / values.length));
}

/**
 * Sure's `PERCENTILE_CONT(0.5)` and `AVG` over `period_totals`, then `ABS`:
 * each month's sum on one side, over the months holding a line of it.
 */
function statsOf(rows: readonly MonthlyCashFlowRow[]): Stats {
	const sums: Record<keyof Stats, Map<IsoMonth, number>> = {
		income: new Map(),
		expense: new Map(),
	};

	for (const row of rows) {
		const side = sums[sideOf(row.amount)];
		side.set(row.month, (side.get(row.month) ?? 0) + row.amount);
	}

	const sideStats = (side: keyof Stats): SideStats => {
		const totals = [...sums[side].values()].map((total) => toMinorUnits(Math.abs(total)));

		return { median: medianOf(totals), average: averageOf(totals) };
	};

	return { income: sideStats("income"), expense: sideStats("expense") };
}

/**
 * Sure's `IncomeStatement::FamilyStats` by month: every counted row of the
 * history, the current and future months included, each on the side of its
 * sign, summed per calendar month. A refund is income in its month, so a
 * month whose refunds cancel its spending keeps both figures.
 */
export function familyStats(rows: readonly MonthlyCashFlowRow[]): Stats {
	return statsOf(rows);
}

/**
 * Sure's `IncomeStatement::CategoryStats`: `familyStats` per category, a
 * row's own category only, so a parent never takes its children's rows.
 * Uncategorised rows have the `null` key; a category without a counted row
 * has none.
 */
export function categoryStats(rows: readonly MonthlyCashFlowRow[]): Map<string | null, Stats> {
	const byCategory = new Map<string | null, MonthlyCashFlowRow[]>();

	for (const row of rows) {
		const own = byCategory.get(row.categoryId);

		if (own === undefined) {
			byCategory.set(row.categoryId, [row]);
		} else {
			own.push(row);
		}
	}

	return new Map([...byCategory].map(([id, categoryRows]) => [id, statsOf(categoryRows)]));
}
