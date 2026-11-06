import type { BalanceChange, DateRange } from "../domain/balances/history.ts";
import type { CashFlowCategory } from "../domain/cash-flow.ts";
import type { IsoDate, IsoMonth } from "../domain/dates.ts";
import type { ReportsPageQuery } from "../schemas/reports.ts";
import type { ServiceDeps } from "./deps.ts";
import type { ActivityRow } from "./ledger/queries.ts";

import { eq } from "drizzle-orm";

import type { AccountType, Classification } from "@archant/data/account-types";
import { ACCOUNT_TYPE_IDS, classificationOf } from "@archant/data/account-types";
import type { CategoryIcon } from "@archant/data/category-presets";
import type { Locale } from "@archant/data/locales";
import { INTL_LOCALES, LOCALES, pickLocale } from "@archant/data/locales";
import type { MinorUnits } from "@archant/data/money";
import { formatMoney, toMinorUnits } from "@archant/data/money";
import type { ReportNavigation, ReportPeriod } from "@archant/data/report-periods";
import { reportNavigation, reportPeriod } from "@archant/data/report-periods";
import { accounts } from "@archant/data/schema/accounts";
import { users } from "@archant/data/schema/auth";

import { seriesDates, seriesPointCount } from "../domain/balances/sure-periods.ts";
import { grossCashFlow } from "../domain/cash-flow.ts";
import { minDate, monthRange, today } from "../domain/dates.ts";
import { AppError } from "../lib/errors.ts";
import { listAccounts } from "./accounts.ts";
import { getBudget } from "./budgets.ts";
import { csv, textCell } from "./export.ts";
import {
	activityByCategory,
	activityTrades,
	cashFlowByDay,
	hasAnyTransaction,
	transactionsByCategoryMonth,
} from "./ledger/queries.ts";
import { getReportInvestments } from "./report-investments.ts";
import {
	breakdownCategories,
	cashFlowAccounts,
	getBalanceSheet,
	getNetWorth,
	monthBuckets,
} from "./reports.ts";

/** Sure's `build_summary_metrics`: every amount positive but the savings, as Sure shows them. */
type ReportsSummary = {
	income: MinorUnits;
	expenses: MinorUnits;
	netSavings: MinorUnits;
	/** Against the comparison period, in percent with one decimal; 0 when it had none. */
	incomeChange: number;
	expenseChange: number;
	/** Spent over budgeted this month, one decimal; `null` off the current month. */
	budgetPercent: number | null;
};

/** One row of « Tendances et aperçus », Sure's `build_trends_data`. */
type TrendRow = {
	month: IsoMonth;
	/** The month's own days, the last cut to the period's end. */
	from: IsoDate;
	to: IsoDate;
	current: boolean;
	income: MinorUnits;
	expenses: MinorUnits;
	net: MinorUnits;
};

/** What a breakdown row stands for: a category, the rows without one, or the trades. */
type BreakdownKind = "category" | "uncategorized" | "other_investments";

type BreakdownLine = {
	kind: BreakdownKind;
	categoryId: string | null;
	/** `null` for « Sans catégorie » and « Autres investissements », the interface's to name. */
	name: string | null;
	color: string | null;
	icon: CategoryIcon | null;
	/** Positive, on the row's side. */
	total: MinorUnits;
	count: number;
	/** Sure's `has_transactions`: a trade-only row has nothing to list on « Transactions ». */
	hasTransactions: boolean;
};

type BreakdownGroup = BreakdownLine & { subcategories: BreakdownLine[] };

type AccountTypeTotal = { type: AccountType; total: MinorUnits };

type ReportsNetWorth = {
	/** Today's figures, whatever the period, as Sure's `balance_sheet`. */
	netWorth: MinorUnits;
	assets: MinorUnits;
	liabilities: MinorUnits;
	/** The period's change, `null` when no counted account has a day in it. */
	change: BalanceChange | null;
	/** Each figure monthly over the period, never past today. */
	series: { date: IsoDate; netWorth: MinorUnits; assets: MinorUnits; liabilities: MinorUnits }[];
	/** Sure's `account_groups` with a balance, by account type, in Sure's order. */
	groups: Record<Classification, AccountTypeTotal[]>;
};

export type ReportsPage = {
	currency: string;
	today: IsoDate;
	period: ReportPeriod;
	navigation: ReportNavigation | null;
	/** Sure's `Current.family.transactions.any?`: the page's empty state otherwise. */
	hasTransactions: boolean;
	/** Sure's `@has_accounts`: the sortable sections show only then. */
	hasAccounts: boolean;
	summary: ReportsSummary;
	trends: TrendRow[];
	breakdown: { income: BreakdownGroup[]; expense: BreakdownGroup[] };
	netWorth: ReportsNetWorth;
	investments: Awaited<ReturnType<typeof getReportInvestments>>["investments"];
	investmentFlows: Awaited<ReturnType<typeof getReportInvestments>>["investmentFlows"];
};

/** `numerator / denominator × 100`, one decimal, half away from zero as Ruby's `round(1)`. */
function percentOneDecimal(numerator: number, denominator: number): number {
	const tenths = (numerator * 1000) / denominator;

	return (Math.sign(tenths) * Math.round(Math.abs(tenths))) / 10;
}

/** Sure's `calculate_percentage_change`: 0 without a previous figure. */
const changeOf = (previous: MinorUnits, current: MinorUnits) =>
	previous === 0 ? 0 : percentOneDecimal(current - previous, previous);

const positive = (amount: MinorUnits) => toMinorUnits(Math.abs(amount));

/**
 * Sure's `calculate_budget_performance`: only a monthly report on the
 * current month, spending over `allocated_spending`, the top-level
 * categories' amounts summed, 0 when they sum to 0, `null` when the month
 * cannot have a budget, as Sure's `rescue`.
 */
async function budgetPercent(
	deps: ServiceDeps,
	period: ReportPeriod,
	asOf: IsoDate,
): Promise<number | null> {
	const month = period.from.slice(0, 7);

	if (period.type !== "monthly" || month !== asOf.slice(0, 7)) {
		return null;
	}

	try {
		const budget = await getBudget(deps, month);

		return budget.allocated === 0 ? 0 : percentOneDecimal(budget.actual.spending, budget.allocated);
	} catch (error) {
		if (error instanceof AppError && error.code === "NOT_FOUND") {
			return null;
		}

		throw error;
	}
}

/** The summary and the trends, from one read of the counted rows (AD-9). */
async function cashFlowFigures(
	deps: ServiceDeps,
	period: ReportPeriod,
	asOf: IsoDate,
): Promise<Pick<ReportsPage, "summary" | "trends">> {
	const trendsFrom = monthRange(period.from.slice(0, 7)).from;
	const [{ counted }, allCategories, budget] = await Promise.all([
		cashFlowAccounts(deps),
		breakdownCategories(deps),
		budgetPercent(deps, period, asOf),
	]);
	const rows = await cashFlowByDay(deps, {
		from: minDate(period.previous.from, trendsFrom),
		to: period.to,
		accountIds: counted.map((row) => row.id),
	});
	const totalsOf = (range: DateRange) => {
		const { income, expenses } = grossCashFlow(
			rows.filter((row) => row.date >= range.from && row.date <= range.to),
			allCategories,
		);

		return { income: positive(income), expenses: positive(expenses) };
	};
	const current = totalsOf(period);
	const previous = totalsOf(period.previous);

	return {
		summary: {
			income: current.income,
			expenses: current.expenses,
			netSavings: toMinorUnits(current.income - current.expenses),
			incomeChange: changeOf(previous.income, current.income),
			expenseChange: changeOf(previous.expenses, current.expenses),
			budgetPercent: budget,
		},
		trends: monthBuckets(trendsFrom, period.to).map((range) => {
			const { income, expenses } = totalsOf(range);

			return {
				month: range.from.slice(0, 7),
				...range,
				current: range.from.slice(0, 7) === asOf.slice(0, 7),
				income,
				expenses,
				net: toMinorUnits(income - expenses),
			};
		}),
	};
}

type Bucket = BreakdownGroup & { children: Map<string, BreakdownLine> };

function lineOf(
	kind: BreakdownKind,
	category: CashFlowCategory | null,
	hasTransactions: boolean,
): BreakdownLine {
	return {
		kind,
		categoryId: category?.id ?? null,
		name: category?.name ?? null,
		color: category?.color ?? null,
		icon: category?.icon ?? null,
		total: toMinorUnits(0),
		count: 0,
		hasTransactions,
	};
}

/** Adds `row` to `line`, in place. */
function add(line: BreakdownLine, row: Pick<ActivityRow, "amount" | "count">) {
	line.total = toMinorUnits(line.total + Math.abs(row.amount));
	line.count += row.count;
}

/** Largest first, by name among equals, as the page shows a side before any sort. */
const byTotal = (a: BreakdownLine, b: BreakdownLine) =>
	b.total - a.total || (a.name ?? "").localeCompare(b.name ?? "");

/**
 * Sure's `build_transactions_breakdown`: each side's top-level categories,
 * a sub-category's rows added to its parent and listed under it, then the
 * trades as « Autres investissements ».
 */
function breakdownOf(
	rows: readonly ActivityRow[],
	trades: readonly Omit<ActivityRow, "categoryId">[],
	allCategories: readonly CashFlowCategory[],
): ReportsPage["breakdown"] {
	const byId = new Map(allCategories.map((category) => [category.id, category]));
	const sides = { income: new Map<string, Bucket>(), expense: new Map<string, Bucket>() };
	const bucketOf = (outflow: boolean, key: string, make: () => BreakdownLine): Bucket => {
		const side = sides[outflow ? "expense" : "income"];
		const found = side.get(key);

		if (found !== undefined) {
			return found;
		}

		const bucket: Bucket = { ...make(), subcategories: [], children: new Map() };
		side.set(key, bucket);

		return bucket;
	};

	for (const row of rows) {
		const own = row.categoryId === null ? undefined : byId.get(row.categoryId);
		const parent = own?.parentId === null || own === undefined ? undefined : byId.get(own.parentId);
		const top = parent ?? own;
		const bucket =
			top === undefined
				? bucketOf(row.outflow, "uncategorized", () => lineOf("uncategorized", null, true))
				: bucketOf(row.outflow, top.id, () => lineOf("category", top, true));

		add(bucket, row);

		if (parent !== undefined && own !== undefined) {
			const child = bucket.children.get(own.id) ?? lineOf("category", own, true);
			bucket.children.set(own.id, child);
			add(child, row);
		}
	}

	for (const trade of trades) {
		add(
			bucketOf(trade.outflow, "other_investments", () => lineOf("other_investments", null, false)),
			trade,
		);
	}

	const sorted = (side: Map<string, Bucket>): BreakdownGroup[] =>
		[...side.values()]
			.map(({ children, ...group }) => ({
				...group,
				subcategories: [...children.values()].toSorted(byTotal),
			}))
			.toSorted(byTotal);

	return { income: sorted(sides.income), expense: sorted(sides.expense) };
}

/** `getBalanceSheet`'s ceiling, Sure's `MAX_SERIES_POINTS`. */
const MAX_CHART_POINTS = 400;

/** Sure's `build_net_worth_metrics`, from the dashboard's counted accounts and balances. */
async function netWorthOf(
	deps: ServiceDeps,
	period: ReportPeriod,
	asOf: IsoDate,
): Promise<ReportsNetWorth> {
	const charted = { from: minDate(period.from, asOf), to: minDate(period.to, asOf) };
	const [trend, sheet, list] = await Promise.all([
		getNetWorth(deps, { period: "last_30_days", startDate: period.from, endDate: period.to }),
		getBalanceSheet(deps, {
			// Sure's chart past 400 points is refused; a custom range that long shows no chart.
			...(seriesPointCount(charted, "1 month") > MAX_CHART_POINTS
				? { from: asOf, to: asOf }
				: charted),
			interval: "1 month",
		}),
		listAccounts(deps),
	]);
	const reported = list.groups
		.flatMap((group) => group.accounts)
		.filter(
			(account) =>
				account.active &&
				!account.excludedFromReports &&
				account.currency === list.reportingCurrency,
		);
	const groupsOf = (classification: Classification): AccountTypeTotal[] =>
		ACCOUNT_TYPE_IDS.filter((type) => classificationOf(type) === classification)
			.map((type) => ({
				type,
				total: toMinorUnits(
					reported
						.filter((account) => account.type === type)
						.reduce((sum, account) => sum + account.balance, 0),
				),
			}))
			.filter((group) => group.total !== 0);
	const dates = sheet.series.netWorth.length === 0 ? [] : seriesDates(sheet.range, sheet.interval);

	return {
		netWorth: sheet.netWorth,
		assets: sheet.assets,
		liabilities: sheet.liabilities,
		change: trend.change,
		series: dates.map((date, index) => ({
			date,
			netWorth: sheet.series.netWorth[index] ?? toMinorUnits(0),
			assets: sheet.series.assets[index] ?? toMinorUnits(0),
			liabilities: sheet.series.liabilities[index] ?? toMinorUnits(0),
		})),
		groups: {
			asset: groupsOf("asset"),
			liability: groupsOf("liability"),
		},
	};
}

async function hasAny(deps: ServiceDeps) {
	const [hasTransactions, account] = await Promise.all([
		hasAnyTransaction(deps),
		deps.db.select({ id: accounts.id }).from(accounts).limit(1).get(),
	]);

	return { hasTransactions, hasAccounts: account !== undefined };
}

/**
 * Sure's `ReportsController#setup_report_data` in one read, which the page
 * and its print layout share so the two never disagree: the period, its
 * navigation, the summary and trends over the counted rows (AD-9), the
 * breakdown over Sure's wider rows, and the net worth. Their totals may
 * therefore differ, as they do in Sure.
 */
export async function getReportsPage(
	deps: ServiceDeps,
	query: ReportsPageQuery,
): Promise<ReportsPage> {
	const asOf = today(deps.timeZone);
	const period = reportPeriod(query.periodType, query.startDate, query.endDate, asOf);
	const [{ currency, counted }, allCategories, figures, netWorth, flags, investments] =
		await Promise.all([
			cashFlowAccounts(deps),
			breakdownCategories(deps),
			cashFlowFigures(deps, period, asOf),
			netWorthOf(deps, period, asOf),
			hasAny(deps),
			getReportInvestments(deps, period),
		]);
	const range = { from: period.from, to: period.to, accountIds: counted.map((row) => row.id) };
	const [rows, trades] = await Promise.all([
		activityByCategory(deps, range),
		activityTrades(deps, range),
	]);

	return {
		currency,
		today: asOf,
		period,
		navigation: reportNavigation(period, asOf),
		...flags,
		...figures,
		...investments,
		breakdown: breakdownOf(rows, trades, allCategories),
		netWorth,
	};
}

/** Ruby's `%b`, which Sure's export writes in English whatever the user's language. */
const MONTH_ABBREVIATIONS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
] as const;

const monthHeader = (month: IsoMonth) =>
	`${MONTH_ABBREVIATIONS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

const compactDate = (date: IsoDate) => date.replaceAll("-", "");

/** The user's language, else the browser's, as the interface picks it. */
async function csvLocale(
	deps: ServiceDeps,
	userId: string,
	acceptLanguage: string | undefined,
): Promise<Locale> {
	const user = await deps.db
		.select({ locale: users.locale })
		.from(users)
		.where(eq(users.id, userId))
		.get();
	const saved = LOCALES.find((locale) => locale === user?.locale);

	return (
		saved ?? pickLocale((acceptLanguage ?? "").split(",").map((part) => part.split(";")[0] ?? ""))
	);
}

const sumOf = (amounts: readonly MinorUnits[]) =>
	toMinorUnits(amounts.reduce((sum, amount) => sum + amount, 0));

type CsvLine = { name: string; months: Map<IsoMonth, MinorUnits>; total: MinorUnits };

/**
 * Sure's `export_transactions` as CSV: one row per category name and side,
 * flat, « Uncategorized » included, its amount in each month of the period
 * and in total, income first, each side largest first, with its totals.
 * Transactions only, pending ones included, as Sure's export reads them.
 */
export async function getReportsCsv(
	deps: ServiceDeps,
	query: ReportsPageQuery,
	reader: { userId: string; acceptLanguage: string | undefined },
): Promise<{ fileName: string; body: string }> {
	const asOf = today(deps.timeZone);
	const period = reportPeriod(query.periodType, query.startDate, query.endDate, asOf);
	const [{ currency, counted }, allCategories, locale] = await Promise.all([
		cashFlowAccounts(deps),
		breakdownCategories(deps),
		csvLocale(deps, reader.userId, reader.acceptLanguage),
	]);
	const rows = await transactionsByCategoryMonth(deps, {
		from: period.from,
		to: period.to,
		accountIds: counted.map((row) => row.id),
	});
	const names = new Map(allCategories.map((category) => [category.id, category.name]));
	const sides = { income: new Map<string, CsvLine>(), expense: new Map<string, CsvLine>() };

	for (const row of rows) {
		const name =
			(row.categoryId === null ? undefined : names.get(row.categoryId)) ?? "Uncategorized";
		const side = sides[row.outflow ? "expense" : "income"];
		const line: CsvLine = side.get(name) ?? {
			name,
			months: new Map<IsoMonth, MinorUnits>(),
			total: toMinorUnits(0),
		};
		const amount = Math.abs(row.amount);
		line.months.set(row.month, toMinorUnits((line.months.get(row.month) ?? 0) + amount));
		line.total = toMinorUnits(line.total + amount);
		side.set(name, line);
	}

	const months = monthBuckets(monthRange(period.from.slice(0, 7)).from, period.to).map((range) =>
		range.from.slice(0, 7),
	);
	const money = (amount: MinorUnits) => formatMoney({ amount, currency }, INTL_LOCALES[locale]);
	const block = (title: string, totalTitle: string, lines: Map<string, CsvLine>) => {
		const sorted = [...lines.values()].toSorted(
			(a, b) => b.total - a.total || a.name.localeCompare(b.name),
		);

		return [
			[title, ...months.map(() => ""), ""],
			...sorted.map((line) => [
				line.name,
				...months.map((month) => money(line.months.get(month) ?? toMinorUnits(0))),
				money(line.total),
			]),
			[
				totalTitle,
				...months.map((month) =>
					money(sumOf(sorted.map((line) => line.months.get(month) ?? toMinorUnits(0)))),
				),
				money(sumOf(sorted.map((line) => line.total))),
			],
		];
	};
	const table = [
		["Category", ...months.map(monthHeader), "Total"],
		...(sides.income.size === 0 ? [] : [...block("INCOME", "TOTAL INCOME", sides.income), []]),
		...(sides.expense.size === 0 ? [] : block("EXPENSES", "TOTAL EXPENSES", sides.expense)),
	];

	return {
		fileName: `transactions_breakdown_${compactDate(period.from)}_to_${compactDate(period.to)}.csv`,
		body: csv(table.map((row) => row.map(textCell))),
	};
}
