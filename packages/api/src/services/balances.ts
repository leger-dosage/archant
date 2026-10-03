import type { DailyBalance } from "../domain/balances/forward.ts";
import type { BalanceChange, SampledSeries } from "../domain/balances/history.ts";
import type { IsoDate } from "../domain/dates.ts";
import type { BalancePeriod } from "../schemas/balances.ts";
import type { AccountGroup, AccountList, AccountSummary } from "./accounts.ts";
import type { ServiceDeps } from "./deps.ts";

import { balanceChange, periodRange, sampleSeries } from "../domain/balances/history.ts";
import { today } from "../domain/dates.ts";
import { getAccount, listAccounts } from "./accounts.ts";
import { balancesBetween, openingDateOf } from "./ledger/balances.ts";

export const PERIOD_MONTHS: Record<BalancePeriod, number | "all"> = {
	"1M": 1,
	"3M": 3,
	"6M": 6,
	"1Y": 12,
	all: "all",
};

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
 * The days of `period` an account opened on `openingDate` has, ending
 * `to`, and its balance on each; none when it opens after `to`.
 */
async function historyOf(
	deps: ServiceDeps,
	accountId: string,
	openingDate: IsoDate,
	period: BalancePeriod,
	to: IsoDate,
) {
	const range = periodRange(PERIOD_MONTHS[period], to, openingDate);
	const points = range === null ? [] : await balancesBetween(deps, accountId, range.from, range.to);

	return { from: range?.from ?? null, points };
}

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
	const { from, points } = await historyOf(deps, accountId, account.openingDate, period, to);

	return { period, from, to, currency: account.currency, points, change: balanceChange(points) };
}

type AccountWithHistory = AccountSummary & {
	/** `getBalanceHistory`'s points, sampled by `sampleSeries`; empty for an account opening after today. */
	balanceSeries: SampledSeries;
};

type GroupWithHistory = Omit<AccountGroup, "accounts"> & { accounts: AccountWithHistory[] };

/**
 * `listAccounts`, each account with its balances over the period as its page
 * charts them, sampled so ten years stay about 120 points.
 */
export async function listAccountsWithHistory(
	deps: ServiceDeps,
	period: BalancePeriod,
): Promise<Omit<AccountList, "groups"> & { groups: GroupWithHistory[] }> {
	const list = await listAccounts(deps);
	const to = today(deps.timeZone);
	const withHistory = async (summary: AccountSummary): Promise<AccountWithHistory> => {
		const openingDate = await openingDateOf(deps, summary.id);
		const points =
			openingDate === null
				? []
				: (await historyOf(deps, summary.id, openingDate, period, to)).points;

		return { ...summary, balanceSeries: sampleSeries(points) };
	};

	return {
		...list,
		groups: await Promise.all(
			list.groups.map(async (group) => ({
				...group,
				accounts: await Promise.all(group.accounts.map(withHistory)),
			})),
		),
	};
}
