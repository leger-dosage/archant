import type { DailyBalance } from "../domain/balances/forward.ts";
import type { BalanceChange } from "../domain/balances/history.ts";
import type { IsoDate } from "../domain/dates.ts";
import type { BalancePeriod } from "../schemas/balances.ts";
import type { ServiceDeps } from "./deps.ts";

import { balanceChange, periodRange } from "../domain/balances/history.ts";
import { today } from "../domain/dates.ts";
import { getAccount } from "./accounts.ts";
import { balancesBetween } from "./ledger.ts";

export type BalanceHistory = {
	period: BalancePeriod;
	/** First and last day of the period; `null` when the account opens after today. */
	from: IsoDate | null;
	to: IsoDate;
	currency: string;
	/**
	 * The end-of-day stored balance (AD-5) of every day of the period, oldest
	 * first, today last; a day without a write carries the previous balance.
	 */
	points: DailyBalance[];
	change: BalanceChange | null;
};

/**
 * An account's daily balances over a period ending today, and how much they
 * moved. Rows past today, written for future-dated transactions, stay out: the
 * chart shows what has happened.
 */
export async function getBalanceHistory(
	deps: ServiceDeps,
	accountId: string,
	period: BalancePeriod,
): Promise<BalanceHistory> {
	const account = await getAccount(deps, accountId);
	const to = today(deps.timeZone);
	const range = periodRange(period, to, account.openingDate);
	const points = range === null ? [] : await balancesBetween(deps, accountId, range.from, range.to);

	return {
		period,
		from: range?.from ?? null,
		to,
		currency: account.currency,
		points,
		change: balanceChange(points),
	};
}
