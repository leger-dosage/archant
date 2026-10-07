import { z } from "zod";

import { toDecimalString } from "@archant/data/money";
import { RECURRING_STATUSES } from "@archant/data/schema/recurring-transactions";

import { recurringInput } from "../schemas/assistants.ts";
import { listRecurring } from "../services/recurring/series.ts";
import { BANK_TEXT, READ_ONLY, decimal, defineTool } from "./tool.ts";

/** A household has a few dozen series; past this many, the assistant narrows its filter. */
const MAX_RECURRING = 200;

export const getRecurringTransactions = defineTool({
	name: "get_recurring_transactions",
	title: "Recurring transactions",
	description: `The payments and incomes that recur on their schedule for about the same amount, as « Récurrents » lists them: current ones first, each by expected next date. Each gives its amount, its expected day and next date, and its last occurrence. ${BANK_TEXT}`,
	scope: "archant:read",
	annotations: READ_ONLY,
	input: recurringInput,
	output: z.object({
		recurring_transactions: z.array(
			z.object({
				id: z.string(),
				name: z.string().describe("The label its transactions carry."),
				merchant_id: z.string().nullable(),
				merchant_name: z.string().nullable(),
				account_id: z.string(),
				account_name: z.string(),
				amount: decimal("Signed: negative is money out"),
				currency: z.string(),
				status: z
					.enum(RECURRING_STATUSES)
					.describe(
						'"suggested": found by Archant, awaiting the owner; "active": followed by the owner; "inactive": paused or retired.',
					),
				expected_day_of_month: z.number().int(),
				next_expected_date: z.string(),
				last_occurrence_date: z.string(),
				occurrence_count: z.number().int(),
				is_manual: z.boolean().describe("Added by the owner from a transaction."),
			}),
		),
		total_results: z.number().int().describe("Every matching series."),
		truncated: z.boolean().describe(`true when more than ${MAX_RECURRING} match.`),
	}),
	run: async (deps, input) => {
		const records = await listRecurring(deps, {
			status: input.status,
			withinDays: input.upcoming_within_days,
		});

		return {
			result: {
				recurring_transactions: records.slice(0, MAX_RECURRING).map((record) => ({
					id: record.id,
					name: record.label,
					merchant_id: record.merchantId,
					merchant_name: record.merchantName,
					account_id: record.accountId,
					account_name: record.accountName,
					amount: toDecimalString(record),
					currency: record.currency,
					status: record.status,
					expected_day_of_month: record.expectedDayOfMonth,
					next_expected_date: record.nextExpectedDate,
					last_occurrence_date: record.lastOccurrenceDate,
					occurrence_count: record.occurrenceCount,
					is_manual: record.manual,
				})),
				total_results: records.length,
				truncated: records.length > MAX_RECURRING,
			},
			changedRows: 0,
		};
	},
});
