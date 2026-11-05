import type { DailyBalance } from "../domain/balances/forward.ts";
import type { BalanceChange, DateRange } from "../domain/balances/history.ts";
import type { ChartQuery, SureInterval } from "../domain/balances/sure-periods.ts";
import type { MonthRows } from "../domain/budgets/categories.ts";
import type { CashFlowSankey } from "../domain/cash-flow-sankey.ts";
import type {
	CashFlowBreakdown,
	CashFlowCategory,
	CashFlowLine,
	CashFlowRow,
	SubcategoryLines,
} from "../domain/cash-flow.ts";
import type { IsoDate, IsoMonth } from "../domain/dates.ts";
import type { PortfolioReturn, TrendDirection } from "../domain/holdings/portfolio.ts";
import type { CountedAccount } from "../domain/net-worth.ts";
import type { MonthlyCashFlowRow, Stats } from "../domain/statistics.ts";
import type { ServiceDeps } from "./deps.ts";

import type { Classification } from "@archant/data/account-types";
import { classificationOf, holdsSecurities, isTaxAdvantaged } from "@archant/data/account-types";
import { formatMicros } from "@archant/data/micros";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { shiftMonth } from "@archant/data/months";
import type { SurePeriod } from "@archant/data/periods";
import { accounts } from "@archant/data/schema/accounts";
import { categories } from "@archant/data/schema/categories";
import type { Account } from "@archant/data/types";

import { balanceChange, clampRange } from "../domain/balances/history.ts";
import {
	resolveChartRange,
	seriesDates,
	seriesPointCount,
	surePeriodRange,
} from "../domain/balances/sure-periods.ts";
import { cashFlowSankey } from "../domain/cash-flow-sankey.ts";
import { grossCashFlow, netCashFlow, sideOf } from "../domain/cash-flow.ts";
import {
	addDays,
	addMonths,
	daysBetween,
	maxDate,
	minDate,
	monthRange,
	today,
} from "../domain/dates.ts";
import { returnOf, topHoldings } from "../domain/holdings/portfolio.ts";
import { classificationSeries, netWorthSeries } from "../domain/net-worth.ts";
import { categoryStats, familyStats } from "../domain/statistics.ts";
import { AppError } from "../lib/errors.ts";
import { balanceOn, balancesBetween, historyStartOf } from "./ledger/balances.ts";
import { currentHoldings } from "./ledger/holdings.ts";
import {
	cashFlowByCategory,
	cashFlowByDay,
	cashFlowByMonth,
	oldestEntryDate,
	tradeTotals,
} from "./ledger/queries.ts";
import { getReportingCurrency } from "./settings.ts";

/** An account left out of the totals because no rate converts its currency. */
type LeftOutAccount = { id: string; name: string; currency: string };

export type NetWorth = {
	/** Sure's key, `null` for a custom range. */
	period: SurePeriod | null;
	/** The period's own first day, before the clamp to the household's history. */
	periodFrom: IsoDate;
	/** First day of the series; `null` when no counted account has a day in the period. */
	from: IsoDate | null;
	to: IsoDate;
	/** The reporting currency every amount below is in. */
	currency: string;
	/** Today's assets minus liabilities: the series' last point. */
	netWorth: MinorUnits;
	assets: MinorUnits;
	/** The amount owed, positive (AD-5). */
	liabilities: MinorUnits;
	/** Net worth at the end of every day of the period, oldest first, its last day last. */
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
 * in reports, held in the reporting currency, and those of them `kept`
 * keeps. Active, included accounts in another currency are `leftOut`, by
 * name, for the net worth notice.
 */
async function reportedAccounts(deps: ServiceDeps, kept: (row: Account) => boolean = () => true) {
	const currency = getReportingCurrency();
	const rows = await deps.db.select().from(accounts);
	const reported = rows.filter((row) => row.active && !row.excludedFromReports && kept(row));
	const counted: Account[] = reported.filter((row) => row.currency === currency);
	const leftOut: LeftOutAccount[] = reported
		.filter((row) => row.currency !== currency)
		.toSorted((a, b) => byName.compare(a.name, b.name))
		.map((row) => ({ id: row.id, name: row.name, currency: row.currency }));

	return { currency, counted, leftOut };
}

/**
 * The accounts every cash-flow report counts, as Sure's
 * `IncomeStatement#eligible_accounts`: `reportedAccounts`' without the
 * tax-advantaged ones, a PEA, an assurance-vie, a retirement plan or a
 * crypto account held tax-exempt, whose money is set aside.
 */
async function cashFlowAccounts(deps: ServiceDeps) {
	const { counted, ...rest } = await reportedAccounts(deps);

	return { ...rest, counted: counted.filter((row) => !isTaxAdvantaged(row)) };
}

/**
 * Every counted account's daily balances over `range`, over the accounts of
 * `reportedAccounts`. Today's set counts for every day, since an account
 * keeps no deactivation date, so a headline always equals the last point.
 * Shared by the dashboard's net worth and the assistant's balance sheet, so
 * the two never disagree.
 */
async function countedBetween(
	deps: ServiceDeps,
	counted: readonly Account[],
	range: DateRange,
): Promise<CountedAccount[]> {
	return Promise.all(
		counted.map(async (row) => ({
			classification: classificationOf(row.type),
			points: await balancesBetween(deps, row.id, range.from, range.to),
		})),
	);
}

/**
 * The dashboard's daily balances over a period, never before the first
 * counted account's history starts nor past today.
 */
async function countedSeries(deps: ServiceDeps, query: ChartQuery) {
	const asOf = today(deps.timeZone);
	const { currency, counted, leftOut } = await reportedAccounts(deps);

	const startDates = await Promise.all(counted.map((row) => historyStartOf(deps.db, row.id, null)));
	const earliest = startDates
		.filter((date): date is IsoDate => date !== null)
		.reduce<IsoDate | null>((min, date) => (min === null || date < min ? date : min), null);
	const { period, range } = resolveChartRange(query, asOf, earliest);
	const charted = earliest === null ? null : clampRange(range, earliest, asOf);

	const series = charted === null ? [] : await countedBetween(deps, counted, charted);
	const assets = totalOf(series, "asset");
	const liabilities = totalOf(series, "liability");

	return {
		period,
		periodFrom: range.from,
		from: charted?.from ?? null,
		to: charted?.to ?? minDate(range.to, asOf),
		currency,
		series,
		netWorth: toMinorUnits(assets - liabilities),
		assets,
		liabilities,
		leftOut,
	};
}

/** The household's net worth over a period, as the dashboard charts it. */
export async function getNetWorth(deps: ServiceDeps, query: ChartQuery): Promise<NetWorth> {
	const { series, ...totals } = await countedSeries(deps, query);
	const points = netWorthSeries(series);

	return { ...totals, points, change: balanceChange(points) };
}

/**
 * Sure's balance sheet range: both dates, else a named period, else the
 * last five years from the oldest entry. Each figure at each of `dates`.
 */
export type BalanceSheetQuery = {
	from?: IsoDate | undefined;
	to?: IsoDate | undefined;
	period?: SurePeriod | undefined;
	interval: SureInterval;
};

/** Sure's `MAX_SERIES_POINTS`. */
const MAX_SERIES_POINTS = 400;

type BalanceSheet = {
	asOf: IsoDate;
	/** Sure's `oldest_entry_date`: today when the ledger holds no entry. */
	oldestEntryDate: IsoDate;
	currency: string;
	/** Today's figures, whatever the range, as Sure's `current`. */
	netWorth: MinorUnits;
	assets: MinorUnits;
	/** The amount owed, positive (AD-5). */
	liabilities: MinorUnits;
	range: DateRange;
	interval: SureInterval;
	/** Each figure at each of Sure's series dates; empty for a range starting today, as Sure's. */
	series: { netWorth: MinorUnits[]; assets: MinorUnits[]; liabilities: MinorUnits[] };
};

/** Each figure of `points` on `dates`, zero on a day before any account opened. */
function valuesAt(points: readonly DailyBalance[], dates: readonly IsoDate[]): MinorUnits[] {
	const byDate = new Map(points.map((point) => [point.date, point.balance]));

	return dates.map((date) => byDate.get(date) ?? toMinorUnits(0));
}

/**
 * Sure's `get_balance_sheet` over any range, from the dashboard's counted
 * accounts and their stored daily balances (AD-8): today's figures, then
 * each at the days Sure's chart series reads, `seriesDates`.
 */
export async function getBalanceSheet(
	deps: ServiceDeps,
	query: BalanceSheetQuery,
): Promise<BalanceSheet> {
	const asOf = today(deps.timeZone);
	const oldest = (await oldestEntryDate(deps)) ?? asOf;
	const range: DateRange =
		query.from !== undefined && query.to !== undefined
			? { from: query.from, to: query.to }
			: query.period === undefined
				? { from: maxDate(addMonths(asOf, -60), oldest), to: asOf }
				: surePeriodRange(query.period, asOf, oldest);

	if (seriesPointCount(range, query.interval) > MAX_SERIES_POINTS) {
		throw new AppError(
			"VALIDATION_ERROR",
			"That period and interval combination produces too many data points. Use a coarser interval or a shorter period.",
			[{ path: "interval", code: "too_many_points" }],
		);
	}

	const { currency, counted } = await reportedAccounts(deps);
	const [current, series] = await Promise.all([
		countedBetween(deps, counted, { from: asOf, to: asOf }),
		range.from === asOf ? [] : countedBetween(deps, counted, range),
	]);
	const dates = range.from === asOf ? [] : seriesDates(range, query.interval);
	const points = netWorthSeries(series);
	const assets = totalOf(current, "asset");
	const liabilities = totalOf(current, "liability");

	return {
		asOf,
		oldestEntryDate: oldest,
		currency,
		netWorth: toMinorUnits(assets - liabilities),
		assets,
		liabilities,
		range,
		interval: query.interval,
		series: {
			netWorth: valuesAt(points, dates),
			assets: valuesAt(classificationSeries(series, "asset"), dates),
			liabilities: valuesAt(classificationSeries(series, "liability"), dates),
		},
	};
}

export type CashFlow = {
	month: IsoMonth;
	from: IsoDate;
	to: IsoDate;
	/** The reporting currency every amount below is in. */
	currency: string;
	/** Sums of the net view's lines: income positive, expenses negative. */
	income: MinorUnits;
	expenses: MinorUnits;
	lines: { income: CashFlowLine[]; expense: CashFlowLine[] };
	/** Active accounts included in reports but held in another currency, by name. */
	leftOut: LeftOutAccount[];
};

/** A month's cash flow beside its gross view, and the rows and categories it was built from. */
type CashFlowWithRows = {
	cashFlow: CashFlow;
	gross: CashFlowBreakdown;
	rows: CashFlowRow[];
	categories: CashFlowCategory[];
};

type DashboardCashFlow = Omit<CashFlow, "month"> & {
	/** Sure's key, `null` for a custom range. */
	period: SurePeriod | null;
	sankey: CashFlowSankey;
};

/**
 * The net view (AD-9) over the dashboard's period, Sure's
 * `net_category_totals` as its `cashflow_sankey` and `outflows_donut` read
 * it: each top-level category on the side of its net, over the accounts net
 * worth counts but the tax-advantaged ones, and the Sankey graph built from
 * it. `all_time` starts at the oldest entry, as Sure's. A line's drill-down
 * filters on category and dates only, so it can also show excluded rows,
 * rows of accounts excluded from reports and of tax-advantaged accounts,
 * which this report leaves out, and transfer sides that kept a category; a
 * deactivated account's rows are hidden from both.
 */
export async function getDashboardCashFlow(
	deps: ServiceDeps,
	query: ChartQuery,
): Promise<DashboardCashFlow> {
	const asOf = today(deps.timeZone);
	const { period, range } = resolveChartRange(query, asOf, await oldestEntryDate(deps));
	const { currency, counted, leftOut } = await cashFlowAccounts(deps);
	const [rows, allCategories] = await Promise.all([
		cashFlowByCategory(deps, { ...range, accountIds: counted.map((row) => row.id) }),
		breakdownCategories(deps),
	]);
	const { subcategories, ...gross } = grossCashFlow(rows, allCategories);
	const net = netCashFlow(gross);

	return {
		period,
		from: range.from,
		to: range.to,
		currency,
		...net,
		leftOut,
		sankey: cashFlowSankey(net, subcategories, allCategories),
	};
}

/** Sure's `top_holdings(limit: 5)`, as its dashboard calls it. */
const TOP_HOLDINGS = 5;

/**
 * A return as the API answers it, Sure's `Trend`: `percent` a plain decimal
 * string of percentage points, or `"Infinity"` and `"-Infinity"` on a zero
 * book value, which `Number` reads back.
 */
type ReturnData = { gain: MinorUnits; percent: string; trend: TrendDirection };

type InvestmentHolding = {
	security: { id: string; name: string; ticker: string | null };
	amount: MinorUnits;
	/** Percent of the larger of `value` and the holdings' total. */
	weight: string | null;
	/** Percent of the book value of its rows with a cost basis; `null` when none has one. */
	returnPercent: string | null;
	/** Sure's `Trend#direction` of that return, which picks its colour; `null` with it. */
	returnTrend: TrendDirection | null;
};

type InvestmentSummary =
	| { available: false }
	| {
			available: true;
			/** Sure's key, `null` for a custom range. */
			period: SurePeriod | null;
			from: IsoDate;
			to: IsoDate;
			currency: string;
			/** Sure's `portfolio_value`: the accounts' balances today, cash included. */
			value: MinorUnits;
			/** Sure's `unrealized_gains_trend`; `null` when no holding has a cost basis. */
			totalReturn: ReturnData | null;
			/** The five largest securities, largest first. */
			holdings: InvestmentHolding[];
			/** Sure's `InvestmentStatement::Totals` over the period. */
			activity: { contributions: MinorUnits; withdrawals: MinorUnits; trades: number };
			/** Investment accounts in another currency, left out of every figure, by name. */
			leftOut: LeftOutAccount[];
	  };

function percentText(percent: PortfolioReturn["percent"]): string {
	if (percent === "+infinity") {
		return "Infinity";
	}

	return percent === "-infinity" ? "-Infinity" : formatMicros(percent);
}

/** A sum of minor units read as text, refused past a safe integer as any amount is. */
const amountOf = (sum: bigint): MinorUnits => toMinorUnits(Number(sum));

/**
 * Sure's `pages/dashboard/_investment_summary` from its `InvestmentStatement`:
 * over Sure's `investment_accounts`, every active account included in
 * reports that holds securities, a PEA and every tax-advantaged one among
 * them, the portfolio's value today, cash included, the return of every
 * holding with a cost basis, the five largest securities rolled up across
 * accounts, and the period's trades. Sure converts every currency; until
 * exchange rates exist, an account in another currency is left out and
 * named (AD-6). `available` is false without any such account, so the
 * interface hides the widget, as Sure's `investment_accounts.any?`.
 */
export async function getInvestmentSummary(
	deps: ServiceDeps,
	query: ChartQuery,
): Promise<InvestmentSummary> {
	const { currency, counted, leftOut } = await reportedAccounts(deps, (row) =>
		holdsSecurities(row.type),
	);

	if (counted.length === 0 && leftOut.length === 0) {
		return { available: false };
	}

	const asOf = today(deps.timeZone);
	const { period, range } = resolveChartRange(query, asOf, await oldestEntryDate(deps));
	const accountIds = counted.map((row) => row.id);
	const [balances, held, totals] = await Promise.all([
		Promise.all(accountIds.map(async (id) => (await balanceOn(deps, id, asOf))?.amount ?? 0)),
		Promise.all(accountIds.map(async (id) => (await currentHoldings(deps.db, id, asOf)).holdings)),
		tradeTotals(deps, { accountIds, ...range }),
	]);
	const value = toMinorUnits(balances.reduce<number>((sum, balance) => sum + balance, 0));
	const rows = held.flat();
	const totalReturn = returnOf(rows, currency);

	return {
		available: true,
		period,
		from: range.from,
		to: range.to,
		currency,
		value,
		totalReturn:
			totalReturn === null ? null : { ...totalReturn, percent: percentText(totalReturn.percent) },
		holdings: topHoldings(rows, value, TOP_HOLDINGS, currency).map((holding) => ({
			security: {
				id: holding.security.id,
				name: holding.security.name,
				ticker: holding.security.ticker,
			},
			amount: holding.amount,
			weight: holding.weight === null ? null : formatMicros(holding.weight),
			returnPercent: holding.return === null ? null : percentText(holding.return.percent),
			returnTrend: holding.return?.trend ?? null,
		})),
		activity: {
			contributions: amountOf(totals.contributions),
			withdrawals: amountOf(totals.withdrawals),
			trades: totals.trades,
		},
		leftOut,
	};
}

/** Sure's `MONEY_FLOW_CHART_MONTHS`: the bars end at the month picked. */
const MONEY_FLOW_CHART_MONTHS = 6;

/**
 * Sure's `money_flow_month_param` and `spending_trend_month_param`: a month
 * after this one, or none, is this month. No lower bound.
 */
function pickedMonth(month: IsoMonth | undefined, asOf: IsoDate): IsoMonth {
	const current = asOf.slice(0, 7);

	return month === undefined || month > current ? current : month;
}

/** A month's days, the last one cut to `asOf` while the month runs. */
function monthToDate(month: IsoMonth, asOf: IsoDate): DateRange {
	const { from, to } = monthRange(month);

	return { from, to: minDate(to, asOf) };
}

/** One bar of Sure's `money_flow`: a month's gross income and expenses. */
type MoneyFlowBar = PeriodTotals & {
	month: IsoMonth;
	/** The month picked. */
	highlighted: boolean;
	/** The month runs on past today. */
	partial: boolean;
};

type MoneyFlow = PeriodTotals & {
	month: IsoMonth;
	currency: string;
	/** Sure's « Balance des opérations »: gross income less gross expenses. */
	balance: MinorUnits;
	/** The accounts picked, among `accounts`; `null` for all of them. */
	accountIds: string[] | null;
	/** Sure's `eligible_accounts`, by name, for the filter. */
	accounts: { id: string; name: string }[];
	/** Six months, oldest first, the month picked last. */
	bars: MoneyFlowBar[];
};

/** Gross income and expenses of the rows dated within `range`. */
function grossTotalsIn(
	rows: readonly (CashFlowRow & { date: IsoDate })[],
	range: DateRange,
): PeriodTotals {
	let income = 0;
	let expenses = 0;

	for (const row of rows) {
		if (row.date >= range.from && row.date <= range.to) {
			if (sideOf(row.amount) === "income") {
				income += row.amount;
			} else {
				expenses += row.amount;
			}
		}
	}

	return { ...range, income: toMinorUnits(income), expenses: toMinorUnits(expenses) };
}

/**
 * Sure's `build_money_flow_data`: the gross view (AD-9) of the month picked
 * and the five before it, each cut to today, over `cashFlowAccounts`' accounts
 * or those of them picked. An id that is not one of them is dropped, as
 * Sure's `money_flow_account_ids_param`; none left is all of them.
 */
export async function getMoneyFlow(
	deps: ServiceDeps,
	query: { month?: IsoMonth | undefined; accountIds?: readonly string[] | undefined },
): Promise<MoneyFlow> {
	const asOf = today(deps.timeZone);
	const month = pickedMonth(query.month, asOf);
	const { currency, counted } = await cashFlowAccounts(deps);
	const eligible = new Set(counted.map((row) => row.id));
	const picked = [...new Set(query.accountIds ?? [])].filter((id) => eligible.has(id));
	const accountIds = picked.length === 0 ? null : picked;
	const months = Array.from({ length: MONEY_FLOW_CHART_MONTHS }, (_, index) =>
		shiftMonth(month, index - MONEY_FLOW_CHART_MONTHS + 1),
	);
	const ranges = months.map((each) => monthToDate(each, asOf));
	const rows = await cashFlowByDay(deps, {
		from: ranges[0]?.from ?? monthRange(month).from,
		to: monthToDate(month, asOf).to,
		accountIds: accountIds ?? [...eligible],
	});
	const bars = months.map((each, index) => {
		const range = ranges[index] ?? monthToDate(each, asOf);

		return {
			month: each,
			...grossTotalsIn(rows, range),
			highlighted: each === month,
			partial: range.to < monthRange(each).to,
		};
	});
	const selected = grossTotalsIn(rows, monthToDate(month, asOf));

	return {
		month,
		...selected,
		currency,
		balance: toMinorUnits(selected.income + selected.expenses),
		accountIds,
		accounts: counted
			.toSorted((a, b) => byName.compare(a.name, b.name))
			.map((row) => ({ id: row.id, name: row.name })),
		bars,
	};
}

/** A day of Sure's cumulative spending curve. */
type SpendingPoint = {
	/** The axis slot, 1 for the month's first day. */
	day: number;
	/** The day the amount runs to: a folded last point keeps the true last day. */
	date: IsoDate;
	/** Spending from the month's first day to `date`, never positive (AD-5). */
	amount: MinorUnits;
};

type SpendingTrend = {
	month: IsoMonth;
	/** The month picked, cut to today while it runs. */
	from: IsoDate;
	to: IsoDate;
	previousMonth: IsoMonth;
	currency: string;
	/** The axis: the month picked's days, whatever the previous month's. */
	days: number;
	current: SpendingPoint[];
	/** The previous month's whole curve, folded into `days` points. */
	previous: SpendingPoint[];
	currentTotal: MinorUnits;
	/** The previous month over as many days as the month picked has run. */
	previousTotal: MinorUnits;
	/** The day `previousTotal` stops at, while it stops before the previous month's end. */
	previousComparisonDay: number | null;
};

/** Sure's `cumulative_spending_series`: one point per day, a day without spending flat. */
function cumulativeSpending(
	range: DateRange,
	daily: ReadonlyMap<IsoDate, MinorUnits>,
): SpendingPoint[] {
	const points: SpendingPoint[] = [];
	let total = toMinorUnits(0);

	for (let date = range.from; date <= range.to; date = addDays(date, 1)) {
		total = toMinorUnits(total + (daily.get(date) ?? 0));
		points.push({ day: points.length + 1, date, amount: total });
	}

	return points;
}

/**
 * Sure's `fold_extra_days`: a longer previous month's extra days fold into
 * the axis' last point, which keeps its slot and takes the true end's date
 * and total, so the curve still ends at the month's total.
 */
function foldExtraDays(series: readonly SpendingPoint[], days: number): SpendingPoint[] {
	const last = series.at(-1);

	if (series.length <= days || last === undefined) {
		return [...series];
	}

	return series
		.slice(0, days)
		.map((point, index) =>
			index === days - 1 ? { ...point, date: last.date, amount: last.amount } : point,
		);
}

/**
 * Sure's `build_spending_trend_data`: the month picked's cumulative daily
 * spending, cut to today while it runs, against the previous month's whole
 * curve, over `cashFlowAccounts`' accounts. Only the expense side counts, as
 * Sure's `DailyExpenseTotals`, so a refund never lowers spending. The
 * previous total compares as many days as the month picked has run when it
 * is this month, the whole previous month otherwise.
 */
export async function getSpendingTrend(
	deps: ServiceDeps,
	monthAsked: IsoMonth | undefined,
): Promise<SpendingTrend> {
	const asOf = today(deps.timeZone);
	const month = pickedMonth(monthAsked, asOf);
	const previousMonth = shiftMonth(month, -1);
	const currentRange = monthToDate(month, asOf);
	const previousRange = monthRange(previousMonth);
	const { currency, counted } = await cashFlowAccounts(deps);
	const rows = await cashFlowByDay(deps, {
		from: previousRange.from,
		to: currentRange.to,
		accountIds: counted.map((row) => row.id),
	});
	const daily = new Map<IsoDate, MinorUnits>();

	for (const row of rows) {
		if (sideOf(row.amount) === "expense") {
			daily.set(row.date, toMinorUnits((daily.get(row.date) ?? 0) + row.amount));
		}
	}

	const days = daysBetween(monthRange(month).from, monthRange(month).to) + 1;
	const current = cumulativeSpending(currentRange, daily);
	const previousWhole = cumulativeSpending(previousRange, daily);
	const comparisonDays =
		month === asOf.slice(0, 7)
			? Math.min(current.length, previousWhole.length)
			: previousWhole.length;

	return {
		month,
		from: currentRange.from,
		to: currentRange.to,
		previousMonth,
		currency,
		days,
		current,
		previous: foldExtraDays(previousWhole, days),
		currentTotal: current.at(-1)?.amount ?? toMinorUnits(0),
		previousTotal: previousWhole[comparisonDays - 1]?.amount ?? toMinorUnits(0),
		previousComparisonDay:
			comparisonDays > 0 && comparisonDays < previousWhole.length ? comparisonDays : null,
	};
}

/**
 * A calendar month's net view (AD-9), with the rows it counted and the
 * categories it read, so a budget computes each category's spending from the
 * same rows. The whole month counts, future-dated rows included.
 */
export async function getCashFlowWithRows(
	deps: ServiceDeps,
	month: IsoMonth,
): Promise<CashFlowWithRows> {
	const { from, to } = monthRange(month);
	const { currency, counted, leftOut } = await cashFlowAccounts(deps);
	const [rows, allCategories] = await Promise.all([
		cashFlowByCategory(deps, { from, to, accountIds: counted.map((row) => row.id) }),
		breakdownCategories(deps),
	]);
	const { income, expenses, lines } = grossCashFlow(rows, allCategories);
	const gross = { income, expenses, lines };

	return {
		cashFlow: { month, from, to, currency, ...netCashFlow(gross), leftOut },
		gross,
		rows,
		categories: allCategories,
	};
}

/** Every category as `grossCashFlow` reads it. */
async function breakdownCategories(deps: ServiceDeps): Promise<CashFlowCategory[]> {
	return deps.db
		.select({
			id: categories.id,
			name: categories.name,
			color: categories.color,
			icon: categories.icon,
			parentId: categories.parentId,
		})
		.from(categories);
}

/** `rows` of the months before `before`, grouped by month, oldest first, a month without a row absent. */
export function historyBefore(rows: readonly MonthlyCashFlowRow[], before: IsoMonth): MonthRows[] {
	const byMonth = new Map<IsoMonth, CashFlowRow[]>();

	for (const { month, ...row } of rows) {
		if (month < before) {
			const monthRows = byMonth.get(month);

			if (monthRows === undefined) {
				byMonth.set(month, [row]);
			} else {
				monthRows.push(row);
			}
		}
	}

	return [...byMonth]
		.toSorted(([a], [b]) => a.localeCompare(b))
		.map(([month, monthRows]) => ({ month, rows: monthRows }));
}

/**
 * The counted rows of every month before `before`, over `cashFlowAccounts`'
 * accounts, read in one query: what the budget's rollover chain takes.
 */
export async function getCashFlowHistory(
	deps: ServiceDeps,
	before: IsoMonth,
): Promise<MonthRows[]> {
	const { counted } = await cashFlowAccounts(deps);
	const rows = await cashFlowByMonth(deps, {
		to: monthRange(shiftMonth(before, -1)).to,
		accountIds: counted.map((row) => row.id),
	});

	return historyBefore(rows, before);
}

/**
 * Every counted row of the history over `cashFlowAccounts`' accounts, keyed by
 * month, no bound on either side: one read from which a budget takes both its
 * rollover history, through `historyBefore`, and its statistics.
 */
export async function getCashFlowMonths(deps: ServiceDeps): Promise<MonthlyCashFlowRow[]> {
	const { counted } = await cashFlowAccounts(deps);

	return cashFlowByMonth(deps, { accountIds: counted.map((row) => row.id) });
}

/** Sure's `FamilyStats` and `CategoryStats`, by month, over one set of accounts. */
export type CashFlowStatistics = {
	family: Stats;
	/** Each category's own rows, « Sans catégorie » under `null`. */
	categories: ReadonlyMap<string | null, Stats>;
};

/**
 * Sure's monthly statistics over every row of `getCashFlowMonths`, so they
 * never depend on the month shown.
 */
export function statisticsOf(rows: readonly MonthlyCashFlowRow[]): CashFlowStatistics {
	return { family: familyStats(rows), categories: categoryStats(rows) };
}

/**
 * The statistics over `cashFlowAccounts`' accounts, as Sure's
 * `IncomeStatement#median_expense`, `avg_expense` and `median_income`: what
 * the goals' reserve reads.
 */
export async function getCashFlowStatistics(deps: ServiceDeps): Promise<CashFlowStatistics> {
	return statisticsOf(await getCashFlowMonths(deps));
}

/** Sure's `MAX_MONTH_BUCKETS`: the monthly series of a period holds 36 months at most. */
const MAX_MONTH_BUCKETS = 36;

export type IncomeStatementQuery = {
	from: IsoDate;
	to: IsoDate;
	/** Sure's `account_ids`: totals of these accounts alone, without the category breakdown. */
	accountIds?: readonly string[] | undefined;
	/** Sure's `group_by: "month"`: a monthly series beside the totals. */
	byMonth: boolean;
	/** Sure's `compare_previous_period`: the equal-length period just before `from`. */
	comparePrevious: boolean;
};

/** Gross income and expenses between two days, both inclusive, as `CashFlow` signs them. */
export type PeriodTotals = { from: IsoDate; to: IsoDate; income: MinorUnits; expenses: MinorUnits };

/** The gross breakdown Sure's statement gives without an account filter. */
type StatementBreakdown = {
	lines: CashFlowBreakdown["lines"];
	/** Each side's top-level lines' sub-categories, by the line's category id. */
	subcategories: SubcategoryLines;
	/**
	 * Sure's `median_income`, `median_expense` and `avg_expense`, from
	 * `FamilyStats`: over every month of the history with a line on that
	 * side, the current and future months included, whatever the period, 0
	 * without one; expenses negative, as `CashFlow` signs them.
	 */
	medianMonthlyIncome: MinorUnits;
	medianMonthlyExpenses: MinorUnits;
	avgMonthlyExpenses: MinorUnits;
	/**
	 * Every category of the household, so a tool lists each one, as Sure's
	 * `IncomeStatement::Totals` does, those without a counted row at zero.
	 */
	categories: CashFlowCategory[];
};

export type IncomeStatement = PeriodTotals & {
	currency: string;
	/** The accounts asked for; `null` for every counted account. */
	accountIds: string[] | null;
	/** `null` with `accountIds`, as Sure's: its category rollups are household-wide. */
	breakdown: StatementBreakdown | null;
	/** Each calendar month the period touches, cut to it; `null` unless asked. */
	months: PeriodTotals[] | null;
	previous: PeriodTotals | null;
};

/**
 * `familyStats` over a day-keyed read: a month's day groups sum to its
 * month's groups, so these are `cashFlowByMonth`'s statistics.
 */
function statementStatistics(rows: readonly (CashFlowRow & { date: IsoDate })[]) {
	const family = familyStats(rows.map((row) => ({ ...row, month: row.date.slice(0, 7) })));

	return {
		medianMonthlyIncome: family.income.median ?? toMinorUnits(0),
		medianMonthlyExpenses: toMinorUnits(0 - (family.expense.median ?? 0)),
		avgMonthlyExpenses: toMinorUnits(0 - (family.expense.average ?? 0)),
	};
}

/** Each calendar month from `from` to `to`, its first and last days cut to them. */
function monthBuckets(from: IsoDate, to: IsoDate): DateRange[] {
	const buckets: DateRange[] = [];

	for (let cursor = from; cursor <= to;) {
		const end = minDate(monthRange(cursor.slice(0, 7)).to, to);
		buckets.push({ from: cursor, to: end });
		cursor = addDays(end, 1);
	}

	return buckets;
}

/**
 * Sure's `get_income_statement` over any period, from the dashboard's
 * counted rows (AD-9) in the gross view, Sure's `IncomeStatement::Totals`:
 * `cashFlowAccounts`' accounts and categories, over days rather than a month. An
 * account outside those, inactive, excluded from reports, tax-advantaged, in
 * another currency or unknown, is refused, as Sure refuses one its totals
 * would silently report as zero.
 */
export async function getIncomeStatement(
	deps: ServiceDeps,
	query: IncomeStatementQuery,
): Promise<IncomeStatement> {
	const { currency, counted } = await cashFlowAccounts(deps);
	const countedIds = new Set(counted.map((row) => row.id));
	const refused = (query.accountIds ?? []).flatMap((id, index) =>
		countedIds.has(id) ? [] : [{ path: `accountIds.${index}`, code: "unknown_account" }],
	);

	if (refused.length > 0) {
		throw new AppError(
			"VALIDATION_ERROR",
			"Some accounts are not counted in income and expenses: inactive, excluded from reports, tax-advantaged, in another currency or unknown.",
			refused,
		);
	}

	const buckets = query.byMonth ? monthBuckets(query.from, query.to) : null;

	if (buckets !== null && buckets.length > MAX_MONTH_BUCKETS) {
		throw new AppError(
			"VALIDATION_ERROR",
			`That range produces more than ${MAX_MONTH_BUCKETS} monthly buckets. Use a shorter range.`,
			[{ path: "groupBy", code: "too_many_periods" }],
		);
	}

	const accountIds = query.accountIds === undefined ? null : [...new Set(query.accountIds)];
	const days = daysBetween(query.from, query.to) + 1;
	const previousRange = { from: addDays(query.from, -days), to: addDays(query.from, -1) };
	// One read for every figure: without an account filter, the statistics
	// need the whole history, so the period's totals filter it rather than
	// scan it again; with one, Sure gives no statistics, so the periods suffice.
	const [dayRows, allCategories] = await Promise.all([
		cashFlowByDay(
			deps,
			accountIds === null
				? { accountIds: [...countedIds] }
				: {
						from: query.comparePrevious ? previousRange.from : query.from,
						to: query.to,
						accountIds,
					},
		),
		breakdownCategories(deps),
	]);
	const rowsIn = (range: DateRange) =>
		dayRows.filter((row) => row.date >= range.from && row.date <= range.to);
	const totalsOf = (range: DateRange): PeriodTotals => {
		const { income, expenses } = grossCashFlow(rowsIn(range), allCategories);

		return { ...range, income, expenses };
	};
	const { income, expenses, lines, subcategories } = grossCashFlow(rowsIn(query), allCategories);

	return {
		from: query.from,
		to: query.to,
		income,
		expenses,
		currency,
		accountIds,
		breakdown:
			accountIds === null
				? { lines, subcategories, ...statementStatistics(dayRows), categories: allCategories }
				: null,
		months: buckets?.map(totalsOf) ?? null,
		previous: query.comparePrevious ? totalsOf(previousRange) : null,
	};
}
