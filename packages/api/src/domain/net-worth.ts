import type { DailyBalance } from "./balances/forward.ts";

import type { Classification } from "@archant/data/account-types";
import { toMinorUnits } from "@archant/data/money";

export type CountedAccount = {
	classification: Classification;
	/** Its daily balances, oldest first, none before its opening date. */
	points: readonly DailyBalance[];
};

/**
 * Net worth of every day any account has a balance on, oldest first: assets
 * minus liabilities, since a liability's stored balance is the positive amount
 * owed (AD-5). An account adds nothing before it opened, as Sure's
 * `COALESCE(…, 0)` does; a day before every account opened has no point.
 */
export function netWorthSeries(accounts: readonly CountedAccount[]): DailyBalance[] {
	const totals = new Map<string, number>();

	for (const account of accounts) {
		const sign = account.classification === "liability" ? -1 : 1;

		for (const point of account.points) {
			totals.set(point.date, (totals.get(point.date) ?? 0) + sign * point.balance);
		}
	}

	return [...totals]
		.toSorted(([a], [b]) => (a < b ? -1 : 1))
		.map(([date, balance]) => ({ date, balance: toMinorUnits(balance) }));
}
