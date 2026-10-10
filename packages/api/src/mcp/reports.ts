import type { CashFlowLine } from "../domain/cash-flow.ts";
import type { PeriodTotals } from "../services/reports.ts";

import { z } from "zod";

import type { MinorUnits } from "@archant/data/money";
import { toDecimalString, toMinorUnits } from "@archant/data/money";

import { SURE_INTERVALS } from "../domain/balances/sure-periods.ts";
import { balanceSheetInput, incomeStatementInput } from "../schemas/assistants.ts";
import { getBalanceSheet, getIncomeStatement } from "../services/reports.ts";
import { READ_ONLY, decimal, defineTool, leftOutFields, leftOutOf } from "./tool.ts";

/** Sure's `to_ai_time_series`: the series' range, step and currency, then its values. */
const history = z
	.object({
		start_date: z.string(),
		end_date: z.string(),
		interval: z.enum(SURE_INTERVALS),
		currency: z.string(),
		values: z
			.array(decimal("The end-of-day figure"))
			.describe(
				"Oldest first: start_date, then each interval added to the previous day, then end_date. Empty for a range starting today.",
			),
	})
	.describe("Over the period asked; the name is Sure's, whatever the interval.");

/** One side of the sheet as Sure's `get_balance_sheet` gives it: today's figure and its history. */
const sheetSide = (what: string) => z.object({ current: decimal(what), monthly_history: history });

const percentOf = (part: number, whole: number) => Math.round((part / whole) * 1000) / 10;

export const getBalanceSheetTool = defineTool({
	name: "get_balance_sheet",
	title: "Balance sheet",
	description:
		"Sure's get_balance_sheet: the household's net worth, assets and liabilities today in the reporting currency, as the dashboard counts them, each with its history over a named period, or between start_date and end_date, at one point per day, week or month. The default is the last five years at one month. It counts the active accounts included in reports and held in the reporting currency.",
	scope: "archant:read",
	annotations: READ_ONLY,
	input: balanceSheetInput,
	output: z.object({
		as_of_date: z.string().describe("Today: the day of every current figure."),
		oldest_account_start_date: z
			.string()
			.describe("The oldest entry's day, an opening balance included; today without one."),
		currency: z.string(),
		net_worth: sheetSide("Assets minus liabilities").extend({
			change: z
				.object({
					amount: decimal("Net worth's last day of the period minus its first counted day"),
					percent: z
						.number()
						.nullable()
						.describe(
							"Percent of the first day's size, one decimal; null when the period starts at zero.",
						),
				})
				.nullable()
				.describe("null for a period without a counted day."),
		}),
		assets: sheetSide("Today's total"),
		liabilities: sheetSide("What is owed today, positive; its history positive too"),
		insights: z.object({
			debt_to_asset_ratio: z
				.number()
				.nullable()
				.describe("Liabilities over assets, in percent, one decimal; null without assets."),
		}),
		...leftOutFields,
	}),
	run: async (deps, input) => {
		const sheet = await getBalanceSheet(deps, input);
		const money = (amount: MinorUnits) => toDecimalString({ amount, currency: sheet.currency });
		const historyOf = (values: readonly MinorUnits[]) => ({
			start_date: sheet.range.from,
			end_date: sheet.range.to,
			interval: sheet.interval,
			currency: sheet.currency,
			values: values.map(money),
		});

		return {
			result: {
				as_of_date: sheet.asOf,
				oldest_account_start_date: sheet.oldestEntryDate,
				currency: sheet.currency,
				net_worth: {
					current: money(sheet.netWorth),
					monthly_history: historyOf(sheet.series.netWorth),
					change:
						sheet.change === null
							? null
							: { amount: money(sheet.change.amount), percent: sheet.change.percent },
				},
				assets: { current: money(sheet.assets), monthly_history: historyOf(sheet.series.assets) },
				liabilities: {
					current: money(sheet.liabilities),
					monthly_history: historyOf(sheet.series.liabilities),
				},
				insights: {
					debt_to_asset_ratio: sheet.assets > 0 ? percentOf(sheet.liabilities, sheet.assets) : null,
				},
				...leftOutOf(sheet.leftOut),
			},
			changedRows: 0,
		};
	},
});

const lineFields = {
	category_id: z.string().nullable().describe("null for uncategorised."),
	name: z.string().nullable().describe("null for uncategorised."),
	total: decimal("Signed: a refund lowers an expense line"),
	percentage_of_total: z
		.number()
		.nullable()
		.describe(
			"The line over its side's total, in percent, one decimal; null when that total is zero.",
		),
};

const side = z.object({
	total: decimal("Signed, the sum of its lines"),
	by_category: z
		.array(
			z.object({
				...lineFields,
				category_id: lineFields.category_id.describe(
					"A top-level category, its sub-categories counted in it; null for uncategorised.",
				),
				subcategory_totals: z
					.array(z.object(lineFields))
					.describe(
						"Its sub-categories' own lines, already in its total, each over the side's total as Sure's.",
					),
			}),
		)
		.nullable()
		.describe("Largest first; null with account_ids, as Sure's."),
});

const periodTotals = {
	start_date: z.string(),
	end_date: z.string(),
	income: decimal("Money in"),
	expenses: decimal("Money out, negative"),
	net: decimal("income plus expenses"),
};

const changeOf = (what: string) =>
	z.object({
		amount: decimal(`This period's ${what} minus the previous period's`),
		percent: z
			.number()
			.nullable()
			.describe(
				"amount over the previous figure, in percent, one decimal; null when the previous figure is zero.",
			),
	});

const shareOf = (amount: MinorUnits, total: MinorUnits) =>
	total === 0 ? null : Math.round((amount / total) * 1000) / 10;

const OMITTED_REASON = "category breakdown is not available with an account filter";

export const getIncomeStatementTool = defineTool({
	name: "get_income_statement",
	title: "Income statement",
	description:
		"Sure's get_income_statement: income and expenses between start_date and end_date in the reporting currency, by top-level category with its sub-categories, largest first: each transaction on the side of its sign, so a refund is income in its category, and a loan payment or an investment contribution an expense; other transfers between accounts, trades, excluded, one-time and pending transactions count in neither. It counts the active accounts included in reports and held in the reporting currency, a PEA or an assurance-vie left out. Month over month: group_by \"month\" adds monthly_series. Against the period before: compare_previous_period. Per account: account_ids gives totals only, as Sure's.",
	scope: "archant:read",
	annotations: READ_ONLY,
	input: incomeStatementInput,
	output: z.object({
		currency: z.string(),
		period: z.object({ start_date: z.string(), end_date: z.string() }),
		account_ids: z.array(z.string()).optional().describe("Only with account_ids: those asked."),
		income: side,
		expense: side.describe("Its total and lines negative, money out."),
		net: decimal("Only with account_ids: income plus expenses").optional(),
		breakdown_omitted_reason: z.string().optional().describe("Only with account_ids."),
		insights: z
			.object({
				net_income: decimal("Income plus the negative expenses"),
				savings_rate: z
					.number()
					.describe("net_income over income, in percent, one decimal; 0 without income."),
				median_monthly_income: decimal(
					"The median of every month's income, the history's months with income",
				),
				median_monthly_expenses: decimal(
					"The median of every month's expenses, negative, the history's months with expenses",
				),
				avg_monthly_expenses: decimal("The mean of those months' expenses, negative"),
			})
			.optional()
			.describe("Without account_ids only, as Sure's."),
		monthly_series: z
			.array(z.object(periodTotals))
			.optional()
			.describe('With group_by "month": each calendar month, oldest first, cut to the period.'),
		previous_period: z
			.object({
				...periodTotals,
				income_change: changeOf("income"),
				expenses_change: changeOf("expenses"),
			})
			.optional()
			.describe("With compare_previous_period: the as many days just before start_date."),
		...leftOutFields,
	}),
	run: async (deps, input) => {
		const statement = await getIncomeStatement(deps, input);
		const money = (amount: MinorUnits) => toDecimalString({ amount, currency: statement.currency });
		const totalsOf = (period: PeriodTotals) => ({
			start_date: period.from,
			end_date: period.to,
			income: money(period.income),
			expenses: money(period.expenses),
			net: money(toMinorUnits(period.income + period.expenses)),
		});
		const changeBetween = (previous: MinorUnits, current: MinorUnits) => ({
			amount: money(toMinorUnits(current - previous)),
			percent: previous === 0 ? null : percentOf(current - previous, previous),
		});
		const { breakdown } = statement;
		const sideOf = (
			total: MinorUnits,
			lines: readonly CashFlowLine[] | null,
			sign: "income" | "expense",
		) => ({
			total: money(total),
			by_category:
				lines === null || breakdown === null
					? null
					: lines.map((entry) => ({
							category_id: entry.categoryId,
							name: entry.name,
							total: money(entry.amount),
							percentage_of_total:
								entry.share === null ? null : Math.round(entry.share * 1000) / 10,
							subcategory_totals: (entry.categoryId === null
								? []
								: (breakdown.subcategories[sign].get(entry.categoryId) ?? [])
							).map((child) => ({
								category_id: child.categoryId,
								name: child.name,
								total: money(child.amount),
								percentage_of_total: shareOf(child.amount, total),
							})),
						})),
		});
		const net = toMinorUnits(statement.income + statement.expenses);
		const { previous } = statement;

		return {
			result: {
				currency: statement.currency,
				period: { start_date: statement.from, end_date: statement.to },
				...(statement.accountIds === null ? {} : { account_ids: statement.accountIds }),
				income: sideOf(statement.income, breakdown?.lines.income ?? null, "income"),
				expense: sideOf(statement.expenses, breakdown?.lines.expense ?? null, "expense"),
				...(breakdown === null
					? { net: money(net), breakdown_omitted_reason: OMITTED_REASON }
					: {
							insights: {
								net_income: money(net),
								savings_rate: statement.income > 0 ? percentOf(net, statement.income) : 0,
								median_monthly_income: money(breakdown.medianMonthlyIncome),
								median_monthly_expenses: money(breakdown.medianMonthlyExpenses),
								avg_monthly_expenses: money(breakdown.avgMonthlyExpenses),
							},
						}),
				...(statement.months === null ? {} : { monthly_series: statement.months.map(totalsOf) }),
				...(previous === null
					? {}
					: {
							previous_period: {
								...totalsOf(previous),
								income_change: changeBetween(previous.income, statement.income),
								expenses_change: changeBetween(previous.expenses, statement.expenses),
							},
						}),
				...leftOutOf(statement.leftOut),
			},
			changedRows: 0,
		};
	},
});
