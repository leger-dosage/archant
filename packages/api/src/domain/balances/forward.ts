import type { IsoDate } from "../dates.ts";

import type { Classification } from "@archant/data/account-types";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";

import { addDays } from "../dates.ts";

export type DailyBalance = { date: IsoDate; balance: MinorUnits };

/** A signed entry amount (AD-5): negative when money leaves the account. */
export type Movement = { date: IsoDate; amount: MinorUnits };

/** What one holding is worth at the end of its day, in the account's currency. */
export type HoldingValue = { date: IsoDate; value: MinorUnits };

/** A day's stored balance with its first term: `balance = cash + holdings value`. */
export type CashBalance = DailyBalance & { cash: MinorUnits };

export type ForwardInput = {
	/** First day to compute. */
	from: IsoDate;
	/** Stored cash at the end of the day before `from`. */
	previousCash: MinorUnits;
	/**
	 * Stored balances that fix the end of their day, such as the opening
	 * anchor. As in Sure's `Balance::ForwardCalculator`, a valuation overrides
	 * that day's movements, and the next day starts from it.
	 */
	valuations: readonly DailyBalance[];
	movements: readonly Movement[];
	/** The holdings of each day, an investment account's; none on any other. */
	holdings: readonly HoldingValue[];
	/** Last day to compute, `max(today, latest entry date)`. */
	until: IsoDate;
	classification: Classification;
};

function sumByDay<Row extends { date: IsoDate }>(
	rows: readonly Row[],
	value: (row: Row) => MinorUnits,
): Map<IsoDate, MinorUnits> {
	const sums = new Map<IsoDate, MinorUnits>();

	for (const row of rows) {
		sums.set(row.date, toMinorUnits((sums.get(row.date) ?? 0) + value(row)));
	}

	return sums;
}

/**
 * Daily balances of a manual account, computed forward (AD-8), as Sure's
 * `base_calculator.rb`. An asset's day cash is `previous cash + sum`, a
 * liability's `previous cash - sum` (AD-5): a card purchase of −30 raises what
 * is owed by 30. A valuation sets the day's total, and the cash becomes that
 * total less the holdings' value. The balance is `cash + holdings value`,
 * the cash itself on an account that holds nothing. Empty when `from` is
 * past `until`, which happens after the latest entry is deleted.
 */
export function forwardBalances(input: ForwardInput): CashBalance[] {
	const sign = input.classification === "asset" ? 1 : -1;
	const valuations = new Map(input.valuations.map((row) => [row.date, row.balance]));
	const sums = sumByDay(input.movements, (row) => row.amount);
	const values = sumByDay(input.holdings, (row) => row.value);
	const rows: CashBalance[] = [];
	let cash: number = input.previousCash;

	for (let date = input.from; date <= input.until; date = addDays(date, 1)) {
		const held = values.get(date) ?? 0;
		const valuation = valuations.get(date);
		cash = valuation === undefined ? cash + sign * (sums.get(date) ?? 0) : valuation - held;
		rows.push({ date, balance: toMinorUnits(cash + held), cash: toMinorUnits(cash) });
	}

	return rows;
}
