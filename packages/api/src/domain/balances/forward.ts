import type { IsoDate } from "../dates.ts";

import type { Classification } from "@archant/data/account-types";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";

import { addDays } from "../dates.ts";

export type DailyBalance = { date: IsoDate; balance: MinorUnits };

/** A signed entry amount (AD-5): negative when money leaves the account. */
export type Movement = { date: IsoDate; amount: MinorUnits };

export type ForwardInput = {
	/** First day to compute. */
	from: IsoDate;
	/** Stored balance at the end of the day before `from`. */
	previous: MinorUnits;
	/**
	 * Stored balances that fix the end of their day, such as the opening
	 * anchor. As in Sure's `Balance::ForwardCalculator`, a valuation overrides
	 * that day's movements, and the next day starts from it.
	 */
	valuations: readonly DailyBalance[];
	movements: readonly Movement[];
	/** Last day to compute, `max(today, latest entry date)`. */
	until: IsoDate;
	classification: Classification;
};

/**
 * Daily balances of a manual account, computed forward (AD-8). An asset's day
 * balance is `previous + sum`, a liability's `previous - sum` (AD-5): a card
 * purchase of −30 raises what is owed by 30. Empty when `from` is past
 * `until`, which happens after the latest entry is deleted.
 */
export function forwardBalances(input: ForwardInput): DailyBalance[] {
	const sign = input.classification === "asset" ? 1 : -1;
	const valuations = new Map(input.valuations.map((row) => [row.date, row.balance]));
	const sums = new Map<IsoDate, number>();

	for (const movement of input.movements) {
		sums.set(movement.date, (sums.get(movement.date) ?? 0) + movement.amount);
	}

	const rows: DailyBalance[] = [];
	let balance: number = input.previous;

	for (let date = input.from; date <= input.until; date = addDays(date, 1)) {
		balance = valuations.get(date) ?? balance + sign * (sums.get(date) ?? 0);
		rows.push({ date, balance: toMinorUnits(balance) });
	}

	return rows;
}
