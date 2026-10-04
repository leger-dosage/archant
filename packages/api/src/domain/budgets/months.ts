import type { IsoDate, IsoMonth } from "../dates.ts";

import { shiftMonth } from "@archant/data/months";

/** The first and last months a budget may be read or saved for, both inclusive. */
export type MonthBounds = { from: IsoMonth; to: IsoMonth };

/** How far before and after the current month budgets reach, as Sure's two years. */
const MONTHS_AROUND = 24;

/**
 * Sure's `budget_date_valid?` on calendar months: from two years before the
 * current month, or the oldest entry's month when earlier, to two years after
 * it. `current` is the month in `APP_TIMEZONE`; `oldestEntry` is `null` when
 * nothing is recorded yet.
 */
export function budgetBounds(current: IsoMonth, oldestEntry: IsoDate | null): MonthBounds {
	const twoYearsBack = shiftMonth(current, -MONTHS_AROUND);
	const oldest = oldestEntry?.slice(0, 7) ?? current;

	return {
		from: oldest < twoYearsBack ? oldest : twoYearsBack,
		to: shiftMonth(current, MONTHS_AROUND),
	};
}

export function isBudgetMonth(month: IsoMonth, bounds: MonthBounds): boolean {
	return month >= bounds.from && month <= bounds.to;
}

/** The months the arrows lead to, `null` past a bound. */
export function neighbours(
	month: IsoMonth,
	bounds: MonthBounds,
): { previousMonth: IsoMonth | null; nextMonth: IsoMonth | null } {
	const previous = shiftMonth(month, -1);
	const next = shiftMonth(month, 1);

	return {
		previousMonth: isBudgetMonth(previous, bounds) ? previous : null,
		nextMonth: isBudgetMonth(next, bounds) ? next : null,
	};
}
