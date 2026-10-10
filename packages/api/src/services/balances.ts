import type { DailyBalance } from "../domain/balances/forward.ts";
import type { BalanceChange, DateRange } from "../domain/balances/history.ts";
import type { SureInterval, SurePeriod } from "../domain/balances/sure-periods.ts";
import type { IsoDate } from "../domain/dates.ts";
import type { BalancePeriod } from "../schemas/balances.ts";
import type { AccountSummary } from "./accounts.ts";
import type { ServiceDeps } from "./deps.ts";

import { eq } from "drizzle-orm";

import type { Classification } from "@archant/data/account-types";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { bankAccounts } from "@archant/data/schema/bank-accounts";
import { bankConnections } from "@archant/data/schema/bank-connections";

import { balanceChange, periodRange } from "../domain/balances/history.ts";
import { periodInterval, seriesDates, surePeriodRange } from "../domain/balances/sure-periods.ts";
import { addDays, maxDate, today } from "../domain/dates.ts";
import { getAccount, listAccounts } from "./accounts.ts";
import { balancesBetween, openingDateOf } from "./ledger/balances.ts";
import { oldestEntryDate } from "./ledger/queries.ts";

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

export type AssistantAccount = AccountSummary & {
	classification: Classification;
	/** Sure's `start_date`: the opening anchor's day. */
	startDate: IsoDate;
	/** Sure's `linked?`: a bank connection feeds it. */
	linked: boolean;
	/**
	 * Its balances at Sure's series dates over the period, from its start
	 * date at the earliest; `null` when it starts after the period ends.
	 */
	series: { range: DateRange; interval: SureInterval; values: MinorUnits[] } | null | undefined;
};

/**
 * Sure's `get_accounts` read: the active accounts, Sure's `visible`, assets
 * then liabilities by name, each with its start date and whether a bank feeds
 * it; given a period, each with its balances at the days Sure's chart series
 * reads, at the step Sure's `Period#interval` picks for its range.
 */
export async function listAssistantAccounts(
	deps: ServiceDeps,
	period?: SurePeriod,
): Promise<AssistantAccount[]> {
	const asOf = today(deps.timeZone);
	const [{ groups }, linkedRows, oldest] = await Promise.all([
		listAccounts(deps),
		deps.db
			.select({ id: accounts.id })
			.from(accounts)
			.innerJoin(bankAccounts, eq(bankAccounts.id, accounts.bankAccountId))
			.innerJoin(bankConnections, eq(bankConnections.id, bankAccounts.bankConnectionId)),
		oldestEntryDate(deps),
	]);
	const linked = new Set(linkedRows.map((row) => row.id));
	const range = period === undefined ? undefined : surePeriodRange(period, asOf, oldest);

	const seriesOf = async (id: string, startDate: IsoDate) => {
		if (range === undefined) {
			return undefined;
		}

		const effective = { from: maxDate(startDate, range.from), to: range.to };

		if (effective.from > effective.to) {
			return null;
		}

		const interval = periodInterval(effective);
		const points = await balancesBetween(deps, id, effective.from, effective.to);
		const byDate = new Map(points.map((point) => [point.date, point.balance]));

		return {
			range: effective,
			interval,
			values: seriesDates(effective, interval).map((date) => byDate.get(date) ?? toMinorUnits(0)),
		};
	};

	return Promise.all(
		groups.flatMap((group) =>
			group.accounts
				.filter((summary) => summary.active)
				.map(async (summary) => {
					// An account always has its opening anchor; Sure's fallback for one without an entry.
					const startDate = (await openingDateOf(deps, summary.id)) ?? addDays(asOf, -1);

					return {
						...summary,
						classification: group.classification,
						startDate,
						linked: linked.has(summary.id),
						series: await seriesOf(summary.id, startDate),
					};
				}),
		),
	);
}
