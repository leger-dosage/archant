import type { IsoDate, IsoMonth } from "../dates.ts";

import { shiftMonth } from "@archant/data/months";

import { monthRange } from "../dates.ts";

/** The first and last months offered for new budgets, both inclusive. */
export type MonthBounds = { from: IsoMonth; to: IsoMonth };

/** How far before and after the current month budgets reach, as Sure's two years. */
const MONTHS_AROUND = 24;

/** The slug is the calendar month in which the period starts. */
export function budgetMonthOf(date: IsoDate, startDay: number): IsoMonth {
	const month = date.slice(0, 7);

	return Number(date.slice(8, 10)) < startDay ? shiftMonth(month, -1) : month;
}

const padDay = (day: number) => String(day).padStart(2, "0");

export function budgetPeriod(month: IsoMonth, startDay: number) {
	if (startDay === 1) {
		const { from, to } = monthRange(month);

		return { startDate: from, endDate: to };
	}

	return {
		startDate: `${month}-${padDay(startDay)}`,
		endDate: `${shiftMonth(month, 1)}-${padDay(startDay - 1)}`,
	};
}

/** Two years either side of the current period, extended back to the oldest entry's period. */
export function budgetBounds(
	current: IsoMonth,
	oldestEntry: IsoDate | null,
	startDay: number,
): MonthBounds {
	const twoYearsBack = shiftMonth(current, -MONTHS_AROUND);
	const oldest = oldestEntry === null ? current : budgetMonthOf(oldestEntry, startDay);

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
