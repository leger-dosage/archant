import type { CashFlowLine } from "../domain/cash-flow.ts";

import { z } from "zod";

import type { MinorUnits } from "@archant/data/money";
import { toDecimalString, toMinorUnits } from "@archant/data/money";

import { today } from "../domain/dates.ts";
import { balanceSheetInput, incomeStatementInput } from "../schemas/assistants.ts";
import { BALANCE_PERIODS } from "../schemas/balances.ts";
import { getBalanceSheet, getCashFlow } from "../services/reports.ts";
import {
	READ_ONLY,
	decimal,
	defineTool,
	leftOutFields,
	leftOutOf,
	seriesOf,
	seriesOutput,
} from "./tool.ts";

export const getBalanceSheetTool = defineTool({
	name: "get_balance_sheet",
	title: "Balance sheet",
	description:
		"The household's net worth today, its assets and its liabilities in the reporting currency, how net worth moved over the period, and the three series, as the dashboard shows them. It counts the active accounts included in reports and held in the reporting currency.",
	scope: "archant:read",
	annotations: READ_ONLY,
	input: balanceSheetInput,
	output: z.object({
		period: z.enum(BALANCE_PERIODS),
		from: z
			.string()
			.nullable()
			.describe("The period's first day; null when no counted account has opened yet."),
		to: z.string().describe("Today."),
		currency: z.string(),
		netWorth: decimal("Assets minus liabilities"),
		assets: decimal("Today's total"),
		liabilities: decimal("What is owed today, positive"),
		change: z
			.object({
				amount: decimal("Net worth's last point minus its first"),
				percent: z
					.number()
					.nullable()
					.describe(
						"Percent of the first point's size, one decimal; null when the period starts at zero.",
					),
			})
			.nullable()
			.describe("null for an empty series."),
		series: z.object({
			netWorth: seriesOutput,
			assets: seriesOutput,
			liabilities: seriesOutput.describe("What is owed, positive. Oldest first."),
		}),
		...leftOutFields,
	}),
	run: async (deps, input) => {
		const sheet = await getBalanceSheet(deps, input.period);
		const money = (amount: MinorUnits) => toDecimalString({ amount, currency: sheet.currency });

		return {
			result: {
				period: sheet.period,
				from: sheet.from,
				to: sheet.to,
				currency: sheet.currency,
				netWorth: money(sheet.netWorth),
				assets: money(sheet.assets),
				liabilities: money(sheet.liabilities),
				change:
					sheet.change === null
						? null
						: { amount: money(sheet.change.amount), percent: sheet.change.percent },
				series: {
					netWorth: seriesOf(sheet.series.netWorth, sheet.currency),
					assets: seriesOf(sheet.series.assets, sheet.currency),
					liabilities: seriesOf(sheet.series.liabilities, sheet.currency),
				},
				...leftOutOf(sheet.leftOut),
			},
			changedRows: 0,
		};
	},
});

const line = z.object({
	categoryId: z.string().nullable().describe("A top-level category; null for uncategorised."),
	name: z.string().nullable(),
	amount: decimal("Signed: a refund lowers an expense line"),
	share: z
		.number()
		.nullable()
		.describe("The line over its side's total, 0 to 1; null when that total is zero."),
});

export const getIncomeStatement = defineTool({
	name: "get_income_statement",
	title: "Income statement",
	description:
		"One calendar month's income and expenses in the reporting currency, by top-level category, largest first, as the dashboard shows them: a sub-category counts in its parent, transfers between accounts, excluded and pending transactions count in neither. It counts the active accounts included in reports and held in the reporting currency.",
	scope: "archant:read",
	annotations: READ_ONLY,
	input: incomeStatementInput,
	output: z.object({
		month: z.string(),
		from: z.string(),
		to: z.string(),
		currency: z.string(),
		income: decimal("Signed, the sum of the income lines"),
		expenses: decimal("Signed, negative, the sum of the expense lines"),
		lines: z.object({ income: z.array(line), expense: z.array(line) }),
		uncategorisedIncome: decimal("Money in without a category, its line among lines.income"),
		uncategorisedExpense: decimal("Money out without a category, its line among lines.expense"),
		...leftOutFields,
	}),
	run: async (deps, input) => {
		const month = input.month ?? today(deps.timeZone).slice(0, 7);
		const cashFlow = await getCashFlow(deps, month);
		const money = (amount: MinorUnits) => toDecimalString({ amount, currency: cashFlow.currency });
		const linesOf = (lines: readonly CashFlowLine[]) =>
			lines.map((entry) => ({
				categoryId: entry.categoryId,
				name: entry.name,
				amount: money(entry.amount),
				share: entry.share,
			}));
		const uncategorised = (lines: readonly CashFlowLine[]) =>
			money(lines.find((entry) => entry.categoryId === null)?.amount ?? toMinorUnits(0));

		return {
			result: {
				month: cashFlow.month,
				from: cashFlow.from,
				to: cashFlow.to,
				currency: cashFlow.currency,
				income: money(cashFlow.income),
				expenses: money(cashFlow.expenses),
				lines: { income: linesOf(cashFlow.lines.income), expense: linesOf(cashFlow.lines.expense) },
				uncategorisedIncome: uncategorised(cashFlow.lines.income),
				uncategorisedExpense: uncategorised(cashFlow.lines.expense),
				...leftOutOf(cashFlow.leftOut),
			},
			changedRows: 0,
		};
	},
});
