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

/** One side of the sheet as Sure's `get_balance_sheet` gives it: today's figure and its history. */
const sheetSide = (what: string) =>
	z.object({ current: decimal(what), monthly_history: seriesOutput });

const percentOf = (part: number, whole: number) => Math.round((part / whole) * 1000) / 10;

export const getBalanceSheetTool = defineTool({
	name: "get_balance_sheet",
	title: "Balance sheet",
	description:
		"The household's net worth today, its assets and its liabilities in the reporting currency, each with its history over the period, and how net worth moved over it, as the dashboard shows them and in Sure's get_balance_sheet shape. It counts the active accounts included in reports and held in the reporting currency.",
	scope: "archant:read",
	annotations: READ_ONLY,
	input: balanceSheetInput,
	output: z.object({
		as_of_date: z.string().describe("Today."),
		period: z.enum(BALANCE_PERIODS),
		start_date: z
			.string()
			.nullable()
			.describe("The period's first day; null when no counted account has opened yet."),
		currency: z.string(),
		net_worth: sheetSide("Assets minus liabilities").extend({
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
		}),
		assets: sheetSide("Today's total"),
		liabilities: sheetSide("What is owed today, positive"),
		insights: z.object({
			debt_to_asset_ratio: z
				.number()
				.nullable()
				.describe("Liabilities over assets, in percent, one decimal; null without assets."),
		}),
		...leftOutFields,
	}),
	run: async (deps, input) => {
		const sheet = await getBalanceSheet(deps, input.period);
		const money = (amount: MinorUnits) => toDecimalString({ amount, currency: sheet.currency });

		return {
			result: {
				as_of_date: sheet.to,
				period: sheet.period,
				start_date: sheet.from,
				currency: sheet.currency,
				net_worth: {
					current: money(sheet.netWorth),
					monthly_history: seriesOf(sheet.series.netWorth, sheet.currency),
					change:
						sheet.change === null
							? null
							: { amount: money(sheet.change.amount), percent: sheet.change.percent },
				},
				assets: {
					current: money(sheet.assets),
					monthly_history: seriesOf(sheet.series.assets, sheet.currency),
				},
				liabilities: {
					current: money(sheet.liabilities),
					monthly_history: seriesOf(sheet.series.liabilities, sheet.currency),
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

const side = z.object({
	total: decimal("Signed, the sum of its lines"),
	by_category: z.array(
		z.object({
			category_id: z.string().nullable().describe("A top-level category; null for uncategorised."),
			name: z.string().nullable().describe("null for uncategorised."),
			total: decimal("Signed: a refund lowers an expense line"),
			percentage_of_total: z
				.number()
				.nullable()
				.describe(
					"The line over its side's total, in percent, one decimal; null when that total is zero.",
				),
		}),
	),
});

export const getIncomeStatement = defineTool({
	name: "get_income_statement",
	title: "Income statement",
	description:
		"One calendar month's income and expenses in the reporting currency, by top-level category, largest first, as the dashboard shows them and in Sure's get_income_statement shape: a sub-category counts in its parent, transfers between accounts, excluded and pending transactions count in neither. It counts the active accounts included in reports and held in the reporting currency.",
	scope: "archant:read",
	annotations: READ_ONLY,
	input: incomeStatementInput,
	output: z.object({
		month: z.string(),
		currency: z.string(),
		period: z.object({ start_date: z.string(), end_date: z.string() }),
		income: side,
		expense: side.describe("Its total and lines negative, money out."),
		insights: z.object({
			net_income: decimal("Income plus the negative expenses"),
			savings_rate: z
				.number()
				.describe("net_income over income, in percent, one decimal; 0 without income."),
		}),
		...leftOutFields,
	}),
	run: async (deps, input) => {
		const month = input.month ?? today(deps.timeZone).slice(0, 7);
		const cashFlow = await getCashFlow(deps, month);
		const money = (amount: MinorUnits) => toDecimalString({ amount, currency: cashFlow.currency });
		const sideOf = (total: MinorUnits, lines: readonly CashFlowLine[]) => ({
			total: money(total),
			by_category: lines.map((entry) => ({
				category_id: entry.categoryId,
				name: entry.name,
				total: money(entry.amount),
				percentage_of_total: entry.share === null ? null : Math.round(entry.share * 1000) / 10,
			})),
		});
		const net = toMinorUnits(cashFlow.income + cashFlow.expenses);

		return {
			result: {
				month: cashFlow.month,
				currency: cashFlow.currency,
				period: { start_date: cashFlow.from, end_date: cashFlow.to },
				income: sideOf(cashFlow.income, cashFlow.lines.income),
				expense: sideOf(cashFlow.expenses, cashFlow.lines.expense),
				insights: {
					net_income: money(net),
					savings_rate: cashFlow.income > 0 ? percentOf(net, cashFlow.income) : 0,
				},
				...leftOutOf(cashFlow.leftOut),
			},
			changedRows: 0,
		};
	},
});
