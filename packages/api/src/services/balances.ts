import type { DailyBalance } from "../domain/balances/forward.ts";
import type { BalanceChange, DateRange } from "../domain/balances/history.ts";
import type { ChartQuery, SureInterval } from "../domain/balances/sure-periods.ts";
import type { IsoDate } from "../domain/dates.ts";
import type { AccountSummary } from "./accounts.ts";
import type { ServiceDeps } from "./deps.ts";

import type { Classification } from "@archant/data/account-types";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import type { SurePeriod } from "@archant/data/periods";

import { balanceChange, clampRange } from "../domain/balances/history.ts";
import {
	periodInterval,
	resolveChartRange,
	seriesDates,
	surePeriodRange,
} from "../domain/balances/sure-periods.ts";
import { addDays, maxDate, minDate, today } from "../domain/dates.ts";
import { getAccount, listAccounts } from "./accounts.ts";
import { balancesBetween, historyStartOf } from "./ledger/balances.ts";
import { oldestEntryDate } from "./ledger/queries.ts";

export type BalanceHistory = {
	/** Sure's key, `null` for a custom range. */
	period: SurePeriod | null;
	/**
	 * The period's own first day, before any clamp: later than `from`'s, the
	 * account's history is shorter than the period, and the interface says
	 * « par rapport à l'historique disponible », as Sure's `comparison_label`.
	 */
	periodFrom: IsoDate;
	/** First and last day charted; `from` is `null` when the account has no day in the period. */
	from: IsoDate | null;
	to: IsoDate;
	currency: string;
	/**
	 * The end-of-day stored balance (AD-5) of every day of the period, oldest
	 * first, the last day last; a day without a write carries the previous balance.
	 */
	points: DailyBalance[];
	change: BalanceChange | null;
};

/**
 * An account's daily balances over a period, never before its history
 * starts nor past today, and how much they moved. Rows past today, written
 * for future-dated transactions, stay out: the chart shows what has happened.
 */
export async function getBalanceHistory(
	deps: ServiceDeps,
	accountId: string,
	query: ChartQuery,
): Promise<BalanceHistory> {
	const account = await getAccount(deps, accountId);
	const asOf = today(deps.timeZone);
	const startDate = await historyStartOf(deps.db, accountId, account.openingDate);
	const { period, range } = resolveChartRange(query, asOf, startDate);
	const charted = clampRange(range, startDate, asOf);
	const points =
		charted === null ? [] : await balancesBetween(deps, accountId, charted.from, charted.to);

	return {
		period,
		periodFrom: range.from,
		from: charted?.from ?? null,
		to: charted?.to ?? minDate(range.to, asOf),
		currency: account.currency,
		points,
		change: balanceChange(points),
	};
}

export type AssistantAccount = AccountSummary & {
	classification: Classification;
	/** Sure's `start_date`: the day its history starts, the oldest entry's. */
	startDate: IsoDate;
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
	const [{ groups }, oldest] = await Promise.all([listAccounts(deps), oldestEntryDate(deps)]);
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
					const startDate = await historyStartOf(deps.db, summary.id, addDays(asOf, -1));

					return {
						...summary,
						classification: group.classification,
						startDate,
						series: await seriesOf(summary.id, startDate),
					};
				}),
		),
	);
}
