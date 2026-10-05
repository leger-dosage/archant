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
		items: z.array(
			z.object({
				id: z.string(),
				label: z.string(),
				merchantId: z.string().nullable(),
				merchantName: z.string().nullable(),
				accountId: z.string(),
				accountName: z.string(),
				amount: decimal("Signed: negative is money out"),
				currency: z.string(),
				status: z
					.enum(RECURRING_STATUSES)
					.describe(
						'"suggested": found by Archant, awaiting the owner; "active": followed by the owner; "inactive": paused or retired.',
					),
				expectedDayOfMonth: z.number().int(),
				nextExpectedDate: z.string(),
				lastOccurrenceDate: z.string(),
				occurrenceCount: z.number().int(),
				manual: z.boolean().describe("Added by the owner from a transaction."),
			}),
		),
		total: z.number().int().describe("Every matching series."),
		truncated: z.boolean().describe(`true when more than ${MAX_RECURRING} match.`),
	}),
	run: async (deps, input) => {
		const records = await listRecurring(deps, input);

		return {
			result: {
				items: records.slice(0, MAX_RECURRING).map((record) => ({
					id: record.id,
					label: record.label,
					merchantId: record.merchantId,
					merchantName: record.merchantName,
					accountId: record.accountId,
					accountName: record.accountName,
					amount: toDecimalString(record),
					currency: record.currency,
					status: record.status,
					expectedDayOfMonth: record.expectedDayOfMonth,
					nextExpectedDate: record.nextExpectedDate,
					lastOccurrenceDate: record.lastOccurrenceDate,
					occurrenceCount: record.occurrenceCount,
					manual: record.manual,
				})),
				total: records.length,
				truncated: records.length > MAX_RECURRING,
			},
			changedRows: 0,
		};
	},
});
