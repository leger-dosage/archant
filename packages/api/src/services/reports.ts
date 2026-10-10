import type { DailyBalance } from "../domain/balances/forward.ts";
import type { BalanceChange, DateRange } from "../domain/balances/history.ts";
import type { SureInterval, SurePeriod } from "../domain/balances/sure-periods.ts";
import type {
	CashFlowBreakdown,
	CashFlowCategory,
	CashFlowLine,
	CashFlowRow,
	MonthBreakdown,
	SubcategoryLines,
} from "../domain/cash-flow.ts";
import type { IsoDate, IsoMonth } from "../domain/dates.ts";
import type { CountedAccount } from "../domain/net-worth.ts";
import type { BalancePeriod } from "../schemas/balances.ts";
import type { ServiceDeps } from "./deps.ts";

import type { Classification } from "@archant/data/account-types";
import { classificationOf, isTaxAdvantaged } from "@archant/data/account-types";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { shiftMonth } from "@archant/data/months";
import { accounts } from "@archant/data/schema/accounts";
import { categories } from "@archant/data/schema/categories";
import type { Account } from "@archant/data/types";

import { balanceChange, periodRange } from "../domain/balances/history.ts";
import { seriesDates, seriesPointCount, surePeriodRange } from "../domain/balances/sure-periods.ts";
import { medianOf } from "../domain/budgets/actuals.ts";
import { grossCashFlow, netCashFlow } from "../domain/cash-flow.ts";
import {
	addDays,
	addMonths,
	daysBetween,
	maxDate,
	minDate,
	monthRange,
	today,
} from "../domain/dates.ts";
import { classificationSeries, netWorthSeries } from "../domain/net-worth.ts";
import { AppError } from "../lib/errors.ts";
import { PERIOD_MONTHS } from "./balances.ts";
import { balancesBetween, openingDateOf } from "./ledger/balances.ts";
import {
	cashFlowByCategory,
	cashFlowByDay,
	cashFlowByMonth,
	oldestEntryDate,
} from "./ledger/queries.ts";
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
 * The accounts every cash-flow report counts, as Sure's
 * `IncomeStatement#eligible_accounts`: `reportedAccounts`' without the
 * tax-advantaged ones, a PEA or an assurance-vie, whose money is set aside.
 */
async function cashFlowAccounts(deps: ServiceDeps) {
	const { counted, ...rest } = await reportedAccounts(deps);

	return { ...rest, counted: counted.filter((row) => !isTaxAdvantaged(row.subtype)) };
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

/** The dashboard's daily balances over a period ending today, never before the first counted account opened. */
async function countedSeries(deps: ServiceDeps, period: BalancePeriod) {
	const to = today(deps.timeZone);
	const { currency, counted, leftOut } = await reportedAccounts(deps);

	const openingDates = await Promise.all(counted.map((row) => openingDateOf(deps, row.id)));
	const earliest = openingDates
		.filter((date): date is IsoDate => date !== null)
		.reduce<IsoDate | null>((min, date) => (min === null || date < min ? date : min), null);
	const range = earliest === null ? null : periodRange(PERIOD_MONTHS[period], to, earliest);

	const series = range === null ? [] : await countedBetween(deps, counted, range);
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
	/** Net worth's last day of the range minus its first counted day. */
	change: BalanceChange | null;
	leftOut: LeftOutAccount[];
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

	const { currency, counted, leftOut } = await reportedAccounts(deps);
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

/**
 * A calendar month's net view (AD-9), Sure's `net_category_totals` as its
 * dashboard shows them: each top-level category on the side of its net, over
 * the accounts net worth counts but the tax-advantaged ones. The whole month
 * counts, future-dated rows included, so a line's drill-down covers the same
 * dates. That list filters on category and dates only, so it can also show
 * excluded rows, rows of accounts excluded from reports and of tax-advantaged
 * accounts, which this report leaves out, and transfer sides that kept a
 * category; a deactivated account's rows are hidden from both.
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
			kind: categories.kind,
			color: categories.color,
			icon: categories.icon,
			parentId: categories.parentId,
		})
		.from(categories);
}

/** One month of `getCashFlowHistory`: its two views beside the rows it counted. */
type MonthHistory = MonthBreakdown & { rows: CashFlowRow[] };

/**
 * `getCashFlow`'s gross and net views of every month before `before`, over
 * the same accounts and from the same rows, read in one query, each beside
 * its rows: what the budget's suggestions, each category's median and the budget's
 * rollover chain take.
 */
export async function getCashFlowHistory(
	deps: ServiceDeps,
	before: IsoMonth,
): Promise<MonthHistory[]> {
	const { counted } = await cashFlowAccounts(deps);
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
			const gross = grossCashFlow(monthRows, allCategories);
			const net = netCashFlow(gross);

			return {
				month,
				gross: { income: gross.income, lines: gross.lines },
				net: { expenses: net.expenses, lines: net.lines },
				rows: monthRows,
			};
		});
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
	 * Sure's `median_monthly_income`, `median_monthly_expenses` and
	 * `avg_monthly_expenses`: over every month of the history up to this one
	 * with a line on that side, whatever the period.
	 */
	medianMonthlyIncome: MinorUnits;
	medianMonthlyExpenses: MinorUnits;
	avgMonthlyExpenses: MinorUnits;
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
	/** Accounts in another currency left out; none with `accountIds`, which refuses them. */
	leftOut: LeftOutAccount[];
};

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

function sumOf(values: readonly MinorUnits[]): MinorUnits {
	return toMinorUnits(values.reduce((sum, value) => sum + value, 0));
}

/**
 * Sure's `get_income_statement` over any period, from the dashboard's
 * counted rows (AD-9) in the gross view, Sure's `IncomeStatement::Totals`:
 * `getCashFlow`'s accounts and categories, over days rather than a month. An
 * account outside those, inactive, excluded from reports, tax-advantaged, in
 * another currency or unknown, is refused, as Sure refuses one its totals
 * would silently report as zero.
 */
export async function getIncomeStatement(
	deps: ServiceDeps,
	query: IncomeStatementQuery,
): Promise<IncomeStatement> {
	const { currency, counted, leftOut } = await cashFlowAccounts(deps);
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
	const thisMonthEnd = monthRange(today(deps.timeZone).slice(0, 7)).to;
	// One read for every figure: the medians need the whole history up to
	// this month, so without an account filter it starts at the first day.
	const [dayRows, allCategories] = await Promise.all([
		cashFlowByDay(deps, {
			...(accountIds === null
				? {}
				: { from: query.comparePrevious ? previousRange.from : query.from }),
			to: accountIds === null ? maxDate(query.to, thisMonthEnd) : query.to,
			accountIds: accountIds ?? [...countedIds],
		}),
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
				? {
						lines,
						subcategories,
						...monthlyStatistics(
							dayRows.filter((row) => row.date <= thisMonthEnd),
							allCategories,
						),
					}
				: null,
		months: buckets?.map(totalsOf) ?? null,
		previous: query.comparePrevious ? totalsOf(previousRange) : null,
		leftOut: accountIds === null ? leftOut : [],
	};
}

/**
 * Sure's family statistics: each calendar month's income and expenses, as
 * `grossCashFlow` sums them, and their median and mean over the months
 * with a line on that side.
 */
function monthlyStatistics(
	rows: readonly (CashFlowRow & { date: IsoDate })[],
	allCategories: readonly CashFlowCategory[],
) {
	const byMonth = new Map<IsoMonth, CashFlowRow[]>();

	for (const row of rows) {
		byMonth.set(row.date.slice(0, 7), [...(byMonth.get(row.date.slice(0, 7)) ?? []), row]);
	}

	const months = [...byMonth.values()].map((monthRows) => grossCashFlow(monthRows, allCategories));
	const incomes = months
		.filter((month) => month.lines.income.length > 0)
		.map((month) => month.income);
	const spent = months
		.filter((month) => month.lines.expense.length > 0)
		.map((month) => month.expenses);

	return {
		medianMonthlyIncome: medianOf(incomes) ?? toMinorUnits(0),
		medianMonthlyExpenses: medianOf(spent) ?? toMinorUnits(0),
		avgMonthlyExpenses: toMinorUnits(
			spent.length === 0 ? 0 : Math.round(sumOf(spent) / spent.length),
		),
	};
}
