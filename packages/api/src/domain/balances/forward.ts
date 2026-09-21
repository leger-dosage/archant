import type { IsoDate } from "../dates.ts";

import type { MinorUnits } from "@archant/data/money";

import { addDays, maxDate } from "../dates.ts";

export type DailyBalance = { date: IsoDate; balance: MinorUnits };

/**
 * Daily balances of a manual account, computed forward from its opening
 * anchor (AD-8). With no transaction yet, every day carries the anchor's
 * value. The range ends at `until`, usually today, or at the anchor itself when
 * the account opens in the future, so an account always has at least one row.
 */
export function forwardBalances(anchor: DailyBalance, until: IsoDate): DailyBalance[] {
	const last = maxDate(until, anchor.date);
	const rows: DailyBalance[] = [];

	for (let date = anchor.date; date <= last; date = addDays(date, 1)) {
		rows.push({ date, balance: anchor.balance });
	}

	return rows;
}
