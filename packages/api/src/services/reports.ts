import type { DailyBalance } from "../domain/balances/forward.ts";
import type { BalanceChange } from "../domain/balances/history.ts";
import type { CashFlowLine } from "../domain/cash-flow.ts";
import type { IsoDate, IsoMonth } from "../domain/dates.ts";
import type { CountedAccount } from "../domain/net-worth.ts";
import type { BalancePeriod } from "../schemas/balances.ts";
import type { ServiceDeps } from "./deps.ts";

import type { Classification } from "@archant/data/account-types";
import { classificationOf } from "@archant/data/account-types";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { categories } from "@archant/data/schema/categories";
import type { Account } from "@archant/data/types";

import { balanceChange, periodRange } from "../domain/balances/history.ts";
import { cashFlowBreakdown } from "../domain/cash-flow.ts";
import { monthRange, today } from "../domain/dates.ts";
import { netWorthSeries } from "../domain/net-worth.ts";
import { PERIOD_MONTHS } from "./balances.ts";
import { balancesBetween, cashFlowByCategory, openingDateOf } from "./ledger.ts";
import { getReportingCurrency } from "./settings.ts";

/** An account left out of the totals because no rate converts its currency. */
export type LeftOutAccount = { id: string; name: string; currency: string };

export type NetWorth = {
	period: BalancePeriod;
	/** First day of the series; `null` when no counted account has opened by today. */
	from: IsoDate | null;
	to: IsoDate;
	/** The reporting currency every amount below is in. */
	currency: string;
	/** Today's assets minus liabilities: the series' last point. */
	netWorth: MinorUnits;
	assets: MinorUnits;
	/** The amount owed, positive (AD-5). */
	liabilities: MinorUnits;
	/** Net worth at the end of every day of the period, oldest first, today last. */
	points: DailyBalance[];
	change: BalanceChange | null;
	/** Active accounts included in reports but held in another currency, by name. */
	leftOut: LeftOutAccount[];
};

const byName = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

function totalOf(series: readonly CountedAccount[], classification: Classification): MinorUnits {
	return toMinorUnits(
		series
			.filter((account) => account.classification === classification)
			.reduce((sum, account) => sum + (account.points.at(-1)?.balance ?? 0), 0),
	);
}

/**
 * The accounts every report totals, as `listAccounts` does: active, included
 * in reports, held in the reporting currency. Active, included accounts in
 * another currency are `leftOut`, by name, for the net worth notice.
 */
async function reportedAccounts(deps: ServiceDeps) {
	const currency = getReportingCurrency();
	const rows = await deps.db.select().from(accounts);
	const reported = rows.filter((row) => row.active && !row.excludedFromReports);
	const counted: Account[] = reported.filter((row) => row.currency === currency);
	const leftOut: LeftOutAccount[] = reported
		.filter((row) => row.currency !== currency)
		.toSorted((a, b) => byName.compare(a.name, b.name))
		.map((row) => ({ id: row.id, name: row.name, currency: row.currency }));

	return { currency, counted, leftOut };
}

/**
 * The household's net worth over a period ending today, over the accounts of
 * `reportedAccounts`. Today's set counts for every day, since an account keeps
 * no deactivation date, so the headline always equals the last point.
 */
export async function getNetWorth(deps: ServiceDeps, period: BalancePeriod): Promise<NetWorth> {
	const to = today(deps.timeZone);
	const { currency, counted, leftOut } = await reportedAccounts(deps);

	const openingDates = await Promise.all(counted.map((row) => openingDateOf(deps, row.id)));
	const earliest = openingDates
		.filter((date): date is IsoDate => date !== null)
		.reduce<IsoDate | null>((min, date) => (min === null || date < min ? date : min), null);
	const range = earliest === null ? null : periodRange(PERIOD_MONTHS[period], to, earliest);

	const series: CountedAccount[] =
		range === null
			? []
			: await Promise.all(
					counted.map(async (row) => ({
						classification: classificationOf(row.type),
						points: await balancesBetween(deps, row.id, range.from, range.to),
					})),
				);
	const points = netWorthSeries(series);
	const assets = totalOf(series, "asset");
	const liabilities = totalOf(series, "liability");

	return {
		period,
		from: range?.from ?? null,
		to,
		currency,
		netWorth: toMinorUnits(assets - liabilities),
		assets,
		liabilities,
		points,
		change: balanceChange(points),
		leftOut,
	};
}

export type CashFlow = {
	month: IsoMonth;
	from: IsoDate;
	to: IsoDate;
	/** The reporting currency every amount below is in. */
	currency: string;
	/** Signed sums of their lines: a refund lowers « Dépenses », a negative total. */
	income: MinorUnits;
	expenses: MinorUnits;
	lines: { income: CashFlowLine[]; expense: CashFlowLine[] };
};

/**
 * A calendar month's income and expenses by top-level category, over the
 * accounts net worth counts. The whole month counts, future-dated rows
 * included, so a line's drill-down covers the same dates. That list filters on
 * category and dates only, so it can also show excluded rows, rows of accounts
 * this report leaves out and transfer sides that kept a category.
 */
export async function getCashFlow(deps: ServiceDeps, month: IsoMonth): Promise<CashFlow> {
	const { from, to } = monthRange(month);
	const { currency, counted } = await reportedAccounts(deps);
	const [rows, allCategories] = await Promise.all([
		cashFlowByCategory(deps, { from, to, accountIds: counted.map((row) => row.id) }),
		deps.db
			.select({
				id: categories.id,
				name: categories.name,
				kind: categories.kind,
				color: categories.color,
				parentId: categories.parentId,
			})
			.from(categories),
	]);

	return { month, from, to, currency, ...cashFlowBreakdown(rows, allCategories) };
}
