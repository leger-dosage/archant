import type { DailyBalance } from "./balances/forward.ts";

import type { Classification } from "@archant/data/account-types";
import { toMinorUnits } from "@archant/data/money";

export type CountedAccount = {
	classification: Classification;
	/** Its daily balances, oldest first, none before its opening date. */
	points: readonly DailyBalance[];
};

function summed(
	accounts: readonly CountedAccount[],
	signOf: (account: CountedAccount) => number,
): DailyBalance[] {
	const totals = new Map<string, number>();

	for (const account of accounts) {
		const sign = signOf(account);

		for (const point of account.points) {
			totals.set(point.date, (totals.get(point.date) ?? 0) + sign * point.balance);
		}
	}

	return [...totals]
		.toSorted(([a], [b]) => (a < b ? -1 : 1))
		.map(([date, balance]) => ({ date, balance: toMinorUnits(balance) }));
}

/**
 * Net worth of every day any account has a balance on, oldest first: assets
 * minus liabilities, since a liability's stored balance is the positive amount
 * owed (AD-5). An account adds nothing before it opened, as Sure's
 * `COALESCE(…, 0)` does; a day before every account opened has no point.
 */
export function netWorthSeries(accounts: readonly CountedAccount[]): DailyBalance[] {
	return summed(accounts, (account) => (account.classification === "liability" ? -1 : 1));
}

/**
 * The assets', or the liabilities', total of every day one of them has a
 * balance on, as `netWorthSeries` counts them: liabilities as the positive
 * amount owed.
 */
export function classificationSeries(
	accounts: readonly CountedAccount[],
	classification: Classification,
): DailyBalance[] {
	return summed(
		accounts.filter((account) => account.classification === classification),
		() => 1,
	);
}
