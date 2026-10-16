import type { IsoDate } from "../dates.ts";
import type { DailyBalance, Movement } from "./forward.ts";

import type { Classification } from "@archant/data/account-types";
import { toMinorUnits } from "@archant/data/money";

import { addDays } from "../dates.ts";
import { forwardBalances } from "./forward.ts";

export type ReverseInput = {
	/**
	 * First day to compute: the earlier of the opening date and the oldest
	 * booked entry, Sure's `calculation_start_date`.
	 */
	from: IsoDate;
	/** The bank balance at the end of its day, a stored balance (AD-5). */
	anchor: DailyBalance;
	/** The opening anchor: its amount ends its own day, in both directions. */
	opening: DailyBalance;
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
 * next day's movements, unless a reconciliation fixes it, down to the oldest
 * entry, past the opening date when a line precedes it. The opening date
 * ends at the opening anchor's amount, as Sure's `use_opening_anchor_for_date?`,
 * even on the anchor's own day; going backward, the day before it ends there
 * too, the opening day's movements undone for nothing, and the day after
 * keeps the balance derived from the bank's, so the gap between the two is
 * the cash adjustment Sure's `opening_boundary_adjustment` records there.
 * Days after the anchor go forward from it, an opening date among them
 * ending at its amount as a valuation does.
 */
export function reverseBalances(input: ReverseInput): DailyBalance[] {
	const sign = input.classification === "asset" ? 1 : -1;
	const { opening } = input;
	const valuations = new Map(input.valuations.map((row) => [row.date, row.balance]));
	const sums = new Map<IsoDate, number>();

	for (const movement of input.movements) {
		sums.set(movement.date, (sums.get(movement.date) ?? 0) + movement.amount);
	}

	// Sure checks the opening date before anything else, the anchor's own day
	// included.
	const anchor = input.anchor.date === opening.date ? opening : input.anchor;
	const earlier: DailyBalance[] = [];
	let balance: number = anchor.balance;

	for (let date = addDays(anchor.date, -1); date >= input.from; date = addDays(date, -1)) {
		const next = addDays(date, 1);
		const moved = next === opening.date ? 0 : (sums.get(next) ?? 0);
		balance =
			date === opening.date ? opening.balance : (valuations.get(date) ?? balance - sign * moved);
		earlier.push({ date, balance: toMinorUnits(balance) });
	}

	// A bank-linked account holds no security: its cash is its balance.
	const later = forwardBalances({
		from: addDays(anchor.date, 1),
		previousCash: anchor.balance,
		// Last, so the opening anchor wins its day.
		valuations: [...input.valuations, opening],
		movements: input.movements,
		// Only a cash account or a loan is ever linked (`LINKABLE_TYPES`).
		transactionsMoveBalance: true,
		holdings: [],
		until: input.until,
		classification: input.classification,
	}).map((row) => ({ date: row.date, balance: row.balance }));

	return [...earlier.toReversed(), anchor, ...later].filter(
		(row) => row.date >= input.from && row.date <= input.until,
	);
}
