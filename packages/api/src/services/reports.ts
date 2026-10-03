import type { DailyBalance } from "../domain/balances/forward.ts";
import type { BalanceChange, SampledSeries } from "../domain/balances/history.ts";
import type {
	CashFlowCategory,
	CashFlowLine,
	CashFlowRow,
	MonthBreakdown,
} from "../domain/cash-flow.ts";
import type { IsoDate, IsoMonth } from "../domain/dates.ts";
import type { CountedAccount } from "../domain/net-worth.ts";
import type { BalancePeriod } from "../schemas/balances.ts";
import type { ServiceDeps } from "./deps.ts";

import type { Classification } from "@archant/data/account-types";
import { classificationOf } from "@archant/data/account-types";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { shiftMonth } from "@archant/data/months";
import { accounts } from "@archant/data/schema/accounts";
import { categories } from "@archant/data/schema/categories";
import type { Account } from "@archant/data/types";

import { balanceChange, periodRange, sampleSeries } from "../domain/balances/history.ts";
import { cashFlowBreakdown } from "../domain/cash-flow.ts";
import { monthRange, today } from "../domain/dates.ts";
import { classificationSeries, netWorthSeries } from "../domain/net-worth.ts";
import { PERIOD_MONTHS } from "./balances.ts";
import { balancesBetween, openingDateOf } from "./ledger/balances.ts";
import { cashFlowByCategory, cashFlowByMonth } from "./ledger/queries.ts";
import { getReportingCurrency } from "./settings.ts";

/** An account left out of the totals because no rate converts its currency. */
type LeftOutAccount = { id: string; name: string; currency: string };

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
 * Every counted account's daily balances over a period ending today, over
 * the accounts of `reportedAccounts`. Today's set counts for every day, since
 * an account keeps no deactivation date, so a headline always equals the
 * last point. Shared by the dashboard's net worth and the assistant's balance
 * sheet, so the two never disagree.
 */
async function countedSeries(deps: ServiceDeps, period: BalancePeriod) {
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
	const assets = totalOf(series, "asset");
	const liabilities = totalOf(series, "liability");

	return {
		from: range?.from ?? null,
		to,
		currency,
		series,
		netWorth: toMinorUnits(assets - liabilities),
		assets,
		liabilities,
		leftOut,
	};
}

/** The household's net worth over a period ending today, as the dashboard charts it. */
export async function getNetWorth(deps: ServiceDeps, period: BalancePeriod): Promise<NetWorth> {
	const { series, ...totals } = await countedSeries(deps, period);
	const points = netWorthSeries(series);

	return { period, ...totals, points, change: balanceChange(points) };
}

type BalanceSheet = Omit<NetWorth, "points"> & {
	/** Net worth, assets and liabilities (positive), sampled by `sampleSeries`. */
	series: { netWorth: SampledSeries; assets: SampledSeries; liabilities: SampledSeries };
};

/**
 * `getNetWorth`'s figures with the assets' and liabilities' series beside the
 * net worth's, as Sure's balance sheet tool gives them, each sampled so ten
 * years stay about 120 points. The change is the daily series', the
 * dashboard's.
 */
export async function getBalanceSheet(
	deps: ServiceDeps,
	period: BalancePeriod,
): Promise<BalanceSheet> {
	const { series, ...totals } = await countedSeries(deps, period);
	const points = netWorthSeries(series);
	const netWorth = sampleSeries(points);

	return {
		period,
		...totals,
		change: balanceChange(points),
		// At net worth's interval, so the three series line up point for point.
		series: {
			netWorth,
			assets: sampleSeries(classificationSeries(series, "asset"), netWorth.interval),
			liabilities: sampleSeries(classificationSeries(series, "liability"), netWorth.interval),
		},
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
	/** Active accounts included in reports but held in another currency, by name. */
	leftOut: LeftOutAccount[];
};

/** A month's cash flow beside the counted rows and the categories it was built from. */
type CashFlowWithRows = {
	cashFlow: CashFlow;
	rows: CashFlowRow[];
	categories: CashFlowCategory[];
};

/**
 * A calendar month's income and expenses by top-level category, over the
 * accounts net worth counts. The whole month counts, future-dated rows
 * included, so a line's drill-down covers the same dates. That list filters on
 * category and dates only, so it can also show excluded rows, rows of accounts
 * this report leaves out and transfer sides that kept a category.
 */
export async function getCashFlow(deps: ServiceDeps, month: IsoMonth): Promise<CashFlow> {
	return (await getCashFlowWithRows(deps, month)).cashFlow;
}

/**
 * `getCashFlow` with the rows it counted and the categories it read, so a
 * budget computes each category's spending from the same rows (AD-9).
 */
export async function getCashFlowWithRows(
	deps: ServiceDeps,
	month: IsoMonth,
): Promise<CashFlowWithRows> {
	const { from, to } = monthRange(month);
	const { currency, counted, leftOut } = await reportedAccounts(deps);
	const [rows, allCategories] = await Promise.all([
		cashFlowByCategory(deps, { from, to, accountIds: counted.map((row) => row.id) }),
		breakdownCategories(deps),
	]);

	return {
		cashFlow: { month, from, to, currency, ...cashFlowBreakdown(rows, allCategories), leftOut },
		rows,
		categories: allCategories,
	};
}

/** Every category as `cashFlowBreakdown` reads it. */
async function breakdownCategories(deps: ServiceDeps): Promise<CashFlowCategory[]> {
	return deps.db
		.select({
			id: categories.id,
			name: categories.name,
			kind: categories.kind,
			color: categories.color,
			icon: categories.icon,
			parentId: categories.parentId,
		})
		.from(categories);
}

/** One month of `getCashFlowHistory`: its breakdown beside the rows it counted. */
type MonthHistory = MonthBreakdown & { rows: CashFlowRow[] };

/**
 * `getCashFlow`'s breakdown of every month before `before`, over the same
 * accounts and from the same rows, read in one query, each beside its rows:
 * what the budget's suggestions and each category's median take.
 */
export async function getCashFlowHistory(
	deps: ServiceDeps,
	before: IsoMonth,
): Promise<MonthHistory[]> {
	const { counted } = await reportedAccounts(deps);
	const [rows, allCategories] = await Promise.all([
		cashFlowByMonth(deps, {
			to: monthRange(shiftMonth(before, -1)).to,
			accountIds: counted.map((row) => row.id),
		}),
		breakdownCategories(deps),
	]);
	const byMonth = new Map<IsoMonth, CashFlowRow[]>();

	for (const row of rows) {
		byMonth.set(row.month, [...(byMonth.get(row.month) ?? []), row]);
	}

	// Oldest first; a month without a counted row is absent.
	return [...byMonth]
		.toSorted(([a], [b]) => a.localeCompare(b))
		.map(([month, monthRows]) => {
			const { income, lines } = cashFlowBreakdown(monthRows, allCategories);

			return { month, income, lines, rows: monthRows };
		});
}
