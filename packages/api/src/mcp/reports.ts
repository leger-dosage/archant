import type { CashFlowCategory } from "../domain/cash-flow.ts";
import type { IncomeStatement, PeriodTotals } from "../services/reports.ts";

import { z } from "zod";

import type { MinorUnits } from "@archant/data/money";
import { toDecimalString, toMinorUnits } from "@archant/data/money";

import { SURE_INTERVALS } from "../domain/balances/sure-periods.ts";
import { AppError } from "../lib/errors.ts";
import { balanceSheetInput, incomeStatementInput } from "../schemas/assistants/reports.ts";
import { getBalanceSheet, getIncomeStatement } from "../services/reports.ts";
import {
	READ_ONLY,
	defineTool,
	formatMoney,
	formatted,
	percent,
	percentDecimal,
	percentage,
	refuseWithoutSuccess,
} from "./tool.ts";

/** Sure's `to_ai_time_series`: the series' range, step and currency, then its values. */
const history = z
	.union([
		z.object({
			start_date: z.string(),
			end_date: z.string(),
			interval: z.enum(SURE_INTERVALS),
			currency: z.string(),
			values: z
				.array(z.number())
				.describe(
					"Oldest first: start_date, then each interval added to the previous day, then end_date. JSON numbers in the currency's decimals.",
				),
		}),
		z.tuple([]).describe("A range starting today has no history, as Sure's."),
	])
	.describe("Over the period asked; the name is Sure's, whatever the interval.");

/** One side of the sheet as Sure's `get_balance_sheet` gives it: today's figure and its history. */
const sheetSide = (what: string) =>
	z.object({ current: formatted(what), monthly_history: history });

/** Sure's error keys for what a report's service refuses, by the field code it names. */
async function asSure<Answer>(read: Promise<Answer>, accountIds?: readonly string[]) {
	try {
		return await read;
	} catch (error) {
		if (error instanceof AppError && error.code === "VALIDATION_ERROR") {
			const fields = error.fields ?? [];
			const unknown = fields
				.filter((field) => field.code === "unknown_account")
				.map((field) => accountIds?.[Number(field.path.split(".")[1])])
				.filter((id) => id !== undefined);

			if (unknown.length > 0) {
				refuseWithoutSuccess(
					"unknown_account_ids",
					"Some account ids were not found or are not part of income and expense reporting (hidden, excluded-from-reports and tax-advantaged accounts are not eligible). Call get_accounts for ids and retry once with eligible accounts.",
					[...new Set(unknown)],
				);
			}

			for (const code of ["too_many_periods", "too_many_points"] as const) {
				if (fields.some((field) => field.code === code)) {
					refuseWithoutSuccess(code, error.message);
				}
			}
		}

		throw error;
	}
}

const isDate = (value: string) => z.iso.date().safeParse(value).success;

/** Sure's `Date.parse` and `Period` checks, in Sure's order and words. */
function checkRange(from: string, to: string): void {
	if (!isDate(from) || !isDate(to)) {
		refuseWithoutSuccess("invalid_date", "Dates must be valid and in YYYY-MM-DD format.");
	}

	if (to < from) {
		refuseWithoutSuccess("invalid_date", "start_date must be on or before end_date.");
	}
}

/** Rails' `present?`: neither absent nor blank. */
const present = (value: string | undefined): value is string =>
	value !== undefined && value.trim() !== "";

export const getBalanceSheetTool = defineTool({
	name: "get_balance_sheet",
	title: "Balance sheet",
	description:
		"Sure's get_balance_sheet: the household's net worth, assets and liabilities today in the reporting currency, as the dashboard counts them, each with its history over a named period, or between start_date and end_date, at one point per day, week or month. The default is the last five years at one month. It counts the active accounts included in reports and held in the reporting currency; an account in another currency is left out until exchange rates exist. A malformed date or a reversed range answers invalid_date; more than 400 points, too_many_points.",
	scope: "archant:read",
	annotations: READ_ONLY,
	input: balanceSheetInput,
	output: z.object({
		as_of_date: z.string().describe("Today: the day of every current figure."),
		oldest_account_start_date: z
			.string()
			.describe("The oldest entry's day, an opening balance included; today without one."),
		currency: z.string(),
		net_worth: sheetSide("Assets minus liabilities"),
		assets: sheetSide("Today's total"),
		liabilities: sheetSide(
			"What is owed today, positive; its history's values negative, as Sure's",
		),
		insights: z.object({
			debt_to_asset_ratio: percent(
				'Liabilities over assets, no decimal; "0%" without liabilities, "Inf%" without assets',
			),
		}),
	}),
	run: async (deps, input) => {
		const custom = present(input.start_date) && present(input.end_date);

		if (custom) {
			checkRange(input.start_date ?? "", input.end_date ?? "");
		}

		const sheet = await asSure(
			getBalanceSheet(deps, {
				from: custom ? input.start_date : undefined,
				to: custom ? input.end_date : undefined,
				period: input.period,
				interval: input.interval,
			}),
		);
		const money = (amount: MinorUnits) => formatMoney({ amount, currency: sheet.currency });
		const numberOf = (amount: MinorUnits) =>
			Number(toDecimalString({ amount, currency: sheet.currency }));
		const historyOf = (values: readonly MinorUnits[], sign = 1) =>
			sheet.range.from === sheet.asOf
				? ([] as [])
				: {
						start_date: sheet.range.from,
						end_date: sheet.range.to,
						interval: sheet.interval,
						currency: sheet.currency,
						values: values.map((value) => numberOf(toMinorUnits(sign * value))),
					};

		return {
			result: {
				as_of_date: sheet.asOf,
				oldest_account_start_date: sheet.oldestEntryDate,
				currency: sheet.currency,
				net_worth: {
					current: money(sheet.netWorth),
					monthly_history: historyOf(sheet.series.netWorth),
				},
				assets: { current: money(sheet.assets), monthly_history: historyOf(sheet.series.assets) },
				liabilities: {
					current: money(sheet.liabilities),
					monthly_history: historyOf(sheet.series.liabilities, -1),
				},
				insights: {
					debt_to_asset_ratio:
						sheet.liabilities === 0
							? percentage(0, 0)
							: percentage((sheet.liabilities / sheet.assets) * 100, 0),
				},
			},
			changedRows: 0,
		};
	},
});

const subcategoryLine = z.object({
	name: z.string(),
	total: formatted("Its own rows, positive"),
	percentage_of_total: percent("Its total over its side's total, one decimal"),
});

const side = z.object({
	total: formatted("The side's sum, positive"),
	by_category: z
		.array(
			subcategoryLine.extend({
				total: formatted("Positive, its sub-categories counted in it"),
				subcategory_totals: z
					.array(subcategoryLine)
					.describe("Every sub-category, already in its total, each over the side's total."),
			}),
		)
		.nullable()
		.describe(
			"Every top-level category, whatever its kind, then « Non catégorisé » and « Autres investissements », largest first; null with account_ids, as Sure's.",
		),
});

const periodTotals = {
	start_date: z.string(),
	end_date: z.string(),
	income: formatted("Money in"),
	expenses: formatted("Money out, positive"),
	net: formatted("income less expenses, negative when more went out"),
};

const changeOf = (what: string) =>
	z.object({
		amount: formatted(`This period's ${what} less the previous period's, negative when lower`),
		percent: z
			.string()
			.nullable()
			.describe(
				'amount over the previous figure, in percent, rounded to one decimal, a decimal string as Sure\'s, such as "12.5" or "-3.0"; null when the previous figure is zero.',
			),
	});

const OMITTED_REASON = "category breakdown is not available with an account filter";

/** Sure's `fr.yml` names of its two synthetic categories. */
const UNCATEGORISED = "Non catégorisé";
const OTHER_INVESTMENTS = "Autres investissements";

const byName = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

type Line = { name: string; amount: MinorUnits };

/** Largest first, by name among equals. */
const largestFirst = (a: Line, b: Line) => b.amount - a.amount || byName.compare(a.name, b.name);

type Breakdown = NonNullable<IncomeStatement["breakdown"]>;

/**
 * One side as Sure's `build_period_total` lists it: every top-level category
 * of the household with every sub-category, zero included, then its two
 * synthetic categories, « Autres investissements » always zero, since
 * Archant counts an investment's uncategorised rows as uncategorised.
 * Amounts positive.
 */
function linesOf(breakdown: Breakdown, sideName: "income" | "expense") {
	const ids = new Set(breakdown.categories.map((category) => category.id));
	const own = new Map(
		breakdown.lines[sideName].map((line) => [line.categoryId, toMinorUnits(Math.abs(line.amount))]),
	);
	const children = new Map(
		[...breakdown.subcategories[sideName].values()]
			.flat()
			.map((child) => [child.categoryId, toMinorUnits(Math.abs(child.amount))]),
	);
	const isTop = (category: CashFlowCategory) =>
		category.parentId === null || !ids.has(category.parentId);

	return [
		...breakdown.categories.filter(isTop).map((top) => ({
			name: top.name,
			amount: own.get(top.id) ?? toMinorUnits(0),
			subcategories: breakdown.categories
				.filter((child) => child.parentId === top.id)
				.map((child) => ({ name: child.name, amount: children.get(child.id) ?? toMinorUnits(0) }))
				.toSorted(largestFirst),
		})),
		{ name: UNCATEGORISED, amount: own.get(null) ?? toMinorUnits(0), subcategories: [] },
		{ name: OTHER_INVESTMENTS, amount: toMinorUnits(0), subcategories: [] },
	].toSorted(largestFirst);
}

/** Sure's `weight`: a line over its side's total, `"0,0%"` for a zero line. */
const shareOf = (amount: MinorUnits, total: MinorUnits) =>
	percentage(amount === 0 ? 0 : (amount / total) * 100, 1);

export const getIncomeStatementTool = defineTool({
	name: "get_income_statement",
	title: "Income statement",
	description:
		"Sure's get_income_statement: income and expenses between start_date and end_date in the reporting currency, both positive, by top-level category with its sub-categories, largest first: each transaction on the side of its sign, so a refund is income in its category, and a loan payment or an investment contribution an expense; other transfers between accounts, trades, excluded, one-time and pending transactions count in neither. Every category is listed on both sides, those without a transaction at zero. It counts the active accounts included in reports and held in the reporting currency, a PEA, an assurance-vie or a retirement plan left out; an account in another currency is left out until exchange rates exist. Month over month: group_by \"month\" adds monthly_series. Against the period before: compare_previous_period. Per account: account_ids gives totals only, as Sure's. A malformed date or a reversed range answers invalid_date; an account the totals do not count, unknown_account_ids; more than 36 months, too_many_periods.",
	scope: "archant:read",
	annotations: READ_ONLY,
	input: incomeStatementInput,
	output: z.object({
		currency: z.string(),
		period: z.object({ start_date: z.string(), end_date: z.string() }),
		account_ids: z.array(z.string()).optional().describe("Only with account_ids: those asked."),
		income: side,
		expense: side,
		net: formatted("Only with account_ids: income less expenses").optional(),
		breakdown_omitted_reason: z.string().optional().describe("Only with account_ids."),
		insights: z
			.object({
				net_income: formatted("Income less expenses, negative when more went out"),
				savings_rate: percent('net_income over income, three decimals; "0,000%" without income'),
				median_monthly_income: formatted(
					"The median of every month's income, the history's months with income",
				),
				median_monthly_expenses: formatted(
					"The median of every month's expenses, positive, the history's months with expenses",
				),
				avg_monthly_expenses: formatted("The mean of those months' expenses, positive"),
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
	}),
	run: async (deps, input) => {
		checkRange(input.start_date, input.end_date);

		const statement = await asSure(
			getIncomeStatement(deps, {
				from: input.start_date,
				to: input.end_date,
				accountIds: input.account_ids,
				byMonth: input.group_by === "month",
				comparePrevious: input.compare_previous_period,
			}),
			input.account_ids,
		);
		const money = (amount: MinorUnits) => formatMoney({ amount, currency: statement.currency });
		const income = statement.income;
		const expenses = toMinorUnits(Math.abs(statement.expenses));
		const totalsOf = (period: PeriodTotals) => ({
			start_date: period.from,
			end_date: period.to,
			income: money(period.income),
			expenses: money(toMinorUnits(Math.abs(period.expenses))),
			net: money(toMinorUnits(period.income - Math.abs(period.expenses))),
		});
		const changeBetween = (previous: MinorUnits, current: MinorUnits) => ({
			amount: money(toMinorUnits(current - previous)),
			percent: previous === 0 ? null : percentDecimal(current - previous, previous, 1),
		});
		const { breakdown, previous } = statement;
		const sideOf = (total: MinorUnits, sideName: "income" | "expense") => ({
			total: money(total),
			by_category:
				breakdown === null
					? null
					: linesOf(breakdown, sideName).map((line) => ({
							name: line.name,
							total: money(line.amount),
							percentage_of_total: shareOf(line.amount, total),
							subcategory_totals: line.subcategories.map((child) => ({
								name: child.name,
								total: money(child.amount),
								percentage_of_total: shareOf(child.amount, total),
							})),
						})),
		});
		const net = toMinorUnits(income - expenses);

		return {
			result: {
				currency: statement.currency,
				period: { start_date: statement.from, end_date: statement.to },
				...(statement.accountIds === null ? {} : { account_ids: statement.accountIds }),
				income: sideOf(income, "income"),
				expense: sideOf(expenses, "expense"),
				...(breakdown === null
					? { net: money(net), breakdown_omitted_reason: OMITTED_REASON }
					: {
							insights: {
								net_income: money(net),
								savings_rate: percentage(
									income === 0 ? 0 : Number(percentDecimal(net, income, 2)),
									3,
								),
								median_monthly_income: money(toMinorUnits(Math.abs(breakdown.medianMonthlyIncome))),
								median_monthly_expenses: money(
									toMinorUnits(Math.abs(breakdown.medianMonthlyExpenses)),
								),
								avg_monthly_expenses: money(toMinorUnits(Math.abs(breakdown.avgMonthlyExpenses))),
							},
						}),
				...(statement.months === null ? {} : { monthly_series: statement.months.map(totalsOf) }),
				...(previous === null
					? {}
					: {
							previous_period: {
								...totalsOf(previous),
								income_change: changeBetween(previous.income, income),
								expenses_change: changeBetween(toMinorUnits(Math.abs(previous.expenses)), expenses),
							},
						}),
			},
			changedRows: 0,
		};
	},
});
