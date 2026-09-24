import type { IsoDate } from "../dates.ts";
import type { DailyBalance, Movement } from "./forward.ts";

import type { Classification } from "@archant/data/account-types";
import { toMinorUnits } from "@archant/data/money";

import { addDays } from "../dates.ts";
import { forwardBalances } from "./forward.ts";

export type ReverseInput = {
	/** First day to compute: the opening anchor's date. Its amount plays no part. */
	from: IsoDate;
	/** The bank balance at the end of its day, a stored balance (AD-5). */
	anchor: DailyBalance;
	/** Reconciliations: each fixes the end of its day, in both directions. */
	valuations: readonly DailyBalance[];
	movements: readonly Movement[];
	/** Last day to compute, `max(today, latest entry date)`. */
	until: IsoDate;
	classification: Classification;
};

/**
 * Daily balances of a bank-linked account, computed backward from its
 * current anchor (AD-8), as Sure's `Balance::ReverseCalculator`. The anchor
 * day is the anchor; each earlier day is the next day's balance less the
 * next day's movements, unless a reconciliation fixes it. The opening
 * anchor's amount is ignored, so no jump appears on the opening day where
 * Sure records a cash adjustment. Days after the anchor go forward from it.
 */
export function reverseBalances(input: ReverseInput): DailyBalance[] {
	const sign = input.classification === "asset" ? 1 : -1;
	const valuations = new Map(input.valuations.map((row) => [row.date, row.balance]));
	const sums = new Map<IsoDate, number>();

	for (const movement of input.movements) {
		sums.set(movement.date, (sums.get(movement.date) ?? 0) + movement.amount);
	}

	const earlier: DailyBalance[] = [];
	let balance: number = input.anchor.balance;

	for (let date = addDays(input.anchor.date, -1); date >= input.from; date = addDays(date, -1)) {
		const next = addDays(date, 1);
		balance = valuations.get(date) ?? balance - sign * (sums.get(next) ?? 0);
		earlier.push({ date, balance: toMinorUnits(balance) });
	}

	const later = forwardBalances({
		from: addDays(input.anchor.date, 1),
		previous: input.anchor.balance,
		valuations: input.valuations,
		movements: input.movements,
		until: input.until,
		classification: input.classification,
	});

	return [...earlier.toReversed(), input.anchor, ...later].filter(
		(row) => row.date >= input.from && row.date <= input.until,
	);
}
