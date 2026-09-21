import type { IsoDate } from "../dates.ts";
import type { DailyBalance } from "./forward.ts";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";

import { addDays, addMonths, maxDate } from "../dates.ts";

export type DateRange = { from: IsoDate; to: IsoDate };

/**
 * The days a period covers: from `today` minus `months` calendar months, or
 * from the opening date for `all`, to `today`. Never before the opening date, since a line
 * before the account existed would read as a real balance. `null` when the
 * account opens after today and the period holds no day.
 */
export function periodRange(
	months: number | "all",
	today: IsoDate,
	openingDate: IsoDate,
): DateRange | null {
	if (openingDate > today) {
		return null;
	}

	const start = months === "all" ? openingDate : addMonths(today, -months);

	return { from: maxDate(start, openingDate), to: today };
}

export type BalanceChange = {
	amount: MinorUnits;
	/**
	 * Percentage points, one decimal, relative to the first balance's size.
	 * `null` when the period starts at zero, where any change is infinite: the
	 * interface then shows the amount alone, as Sure's `Trend` does.
	 */
	percent: number | null;
};

/** The last point minus the first; `null` for an empty series. */
export function balanceChange(points: readonly DailyBalance[]): BalanceChange | null {
	const first = points.at(0);
	const last = points.at(-1);

	if (first === undefined || last === undefined) {
		return null;
	}

	const amount = last.balance - first.balance;
	// Rounded on the magnitude so a rise and a fall of the same size round alike:
	// `Math.round` alone sends −0.25 to −0.2 but +0.25 to +0.3.
	const ratio = amount / Math.abs(first.balance);
	const percent =
		first.balance === 0 ? null : (Math.sign(ratio) * Math.round(Math.abs(ratio) * 1000)) / 10;

	return { amount: toMinorUnits(amount), percent };
}

/**
 * One balance per day from `from` to `to`, both included. `known` holds stored
 * rows, oldest first, and may start before `from`. A day without a row carries
 * the previous balance, as `balanceOn` reads it: rows stop at the last write's
 * end, so an account left untouched for a month has none for that month. Days
 * before the first known row, when the account did not exist yet, are left out.
 */
export function fillDays(
	known: readonly DailyBalance[],
	from: IsoDate,
	to: IsoDate,
): DailyBalance[] {
	const points: DailyBalance[] = [];
	let next = 0;
	let current: MinorUnits | undefined;

	for (let date = from; date <= to; date = addDays(date, 1)) {
		for (let row = known[next]; row !== undefined && row.date <= date; row = known[next]) {
			current = row.balance;
			next += 1;
		}

		if (current !== undefined) {
			points.push({ date, balance: current });
		}
	}

	return points;
}
