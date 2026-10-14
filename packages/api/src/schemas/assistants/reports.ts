import { z } from "zod";

import { SURE_INTERVALS, SURE_PERIODS } from "../../domain/balances/sure-periods.ts";
import { MAX_TAG_FILTER } from "../transactions.ts";
import { requiredLoose } from "./fields.ts";

/**
 * `get_balance_sheet`: Sure's named period, or its custom range when both
 * dates are given, and its series interval. The dates reach `run` loosely
 * typed, which refuses them with Sure's `invalid_date`; an unknown period or
 * interval reads as its default, as Sure's.
 */
export const balanceSheetInput = z.strictObject({
	period: z
		.enum(SURE_PERIODS)
		.optional()
		.catch(undefined)
		.describe("A named period for the history series; the last five years when absent."),
	start_date: z
		.string()
		.optional()
		.describe(
			"A custom range's first day, YYYY-MM-DD; overrides period when end_date is also given.",
		),
	end_date: z
		.string()
		.optional()
		.describe(
			"A custom range's last day, YYYY-MM-DD; overrides period when start_date is also given.",
		),
	interval: z
		.enum(SURE_INTERVALS)
		.catch("1 month")
		.default("1 month")
		.describe('The series\' step, "1 month" by default; 400 points at most.'),
});

/**
 * `get_income_statement`: Sure's period, account filter, monthly series and
 * comparison. The dates reach `run` loosely typed, which refuses them with
 * Sure's `invalid_date`.
 */
export const incomeStatementInput = z.strictObject({
	start_date: requiredLoose(z.string()).describe("The period's first day, YYYY-MM-DD, inclusive."),
	end_date: requiredLoose(z.string()).describe("The period's last day, YYYY-MM-DD, inclusive."),
	account_ids: z
		.array(z.string().min(1))
		.min(1)
		.max(MAX_TAG_FILTER)
		.optional()
		.describe(
			"Account ids from get_accounts: totals of those accounts alone, without the category breakdown or the insights. An inactive account, one excluded from reports, tax-advantaged or in another currency is refused with unknown_account_ids.",
		),
	group_by: z
		.enum(["none", "month"])
		.default("none")
		.describe(
			'"month" adds monthly_series: income, expenses and net per calendar month, the first and last cut to the period, 36 months at most.',
		),
	compare_previous_period: z
		.boolean()
		.default(false)
		.describe(
			"Adds previous_period: the totals of the equal-length period just before start_date, with the changes.",
		),
});
