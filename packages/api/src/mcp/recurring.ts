import type { RecurringRecord } from "../services/recurring/series.ts";

import { z } from "zod";

import type { MinorUnits } from "@archant/data/money";
import { toDecimalString, toMinorUnits } from "@archant/data/money";
import { RECURRING_STATUSES } from "@archant/data/schema/recurring-transactions";

import { today } from "../domain/dates.ts";
import { recurringInput } from "../schemas/assistants.ts";
import { displayName } from "../services/recurring/bills.ts";
import { listRecurring } from "../services/recurring/series.ts";
import { BANK_TEXT, READ_ONLY, decimal, defineTool, namedRef } from "./tool.ts";

/** A household has a few dozen series; past this many, the assistant narrows its filter. */
const MAX_RECURRING = 200;

/** Sure's `expected_amount_range`: the lowest and highest amounts seen, when both are known. */
function rangeOf(record: RecurringRecord): [string, string] | undefined {
	const { expectedAmountMin: min, expectedAmountMax: max, currency } = record;

	return min === null || max === null
		? undefined
		: [toDecimalString({ amount: min, currency }), toDecimalString({ amount: max, currency })];
}

/** Sure's `totals_by_currency`: the active series' amounts, summed in each currency. */
function totalsByCurrency(records: readonly RecurringRecord[]): Record<string, string> {
	const sums = new Map<string, MinorUnits>();

	for (const record of records.filter((item) => item.status === "active")) {
		sums.set(record.currency, toMinorUnits((sums.get(record.currency) ?? 0) + record.amount));
	}

	return Object.fromEntries(
		[...sums].map(([currency, amount]) => [currency, toDecimalString({ amount, currency })]),
	);
}

export const getRecurringTransactions = defineTool({
	name: "get_recurring_transactions",
	title: "Recurring transactions",
	description: `The payments and incomes that recur on their schedule for about the same amount, as « Récurrents » lists them and as Sure's get_recurring_transactions gives them: the active ones by default, each by expected next date, with its amount, its expected day and next date, and its last occurrence. Pass upcoming_within_days to keep the ones expected from today to that many days from now; overdue ones appear only without it. totals_by_currency sums the active ones. ${BANK_TEXT}`,
	scope: "archant:read",
	annotations: READ_ONLY,
	input: recurringInput,
	output: z.object({
		as_of_date: z.string().describe("Today, YYYY-MM-DD."),
		total_results: z.number().int().describe("Every matching series."),
		truncated: z.boolean().describe(`true when more than ${MAX_RECURRING} match.`),
		recurring_transactions: z.array(
			z.object({
				id: z.string(),
				name: z
					.string()
					.describe(
						"The owner's name for it, else its merchant's, else the label its transactions carry.",
					),
				amount: decimal("Signed: negative is money out"),
				expected_amount_range: z
					.tuple([z.string(), z.string()])
					.optional()
					.describe(
						"The lowest and highest amounts seen, signed decimal strings; absent when unknown.",
					),
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
				account: namedRef,
				merchant: namedRef.nullable(),
			}),
		),
		totals_by_currency: z
			.record(z.string(), z.string())
			.describe(
				"Each currency's sum of the matching active series' signed amounts, over every match, not only those shown.",
			),
	}),
	run: async (deps, input) => {
		const records = await listRecurring(deps, {
			status: input.status,
			withinDays: input.upcoming_within_days,
		});

		return {
			result: {
				as_of_date: today(deps.timeZone),
				total_results: records.length,
				truncated: records.length > MAX_RECURRING,
				recurring_transactions: records.slice(0, MAX_RECURRING).map((record) => {
					const range = rangeOf(record);

					return {
						id: record.id,
						name: displayName(record),
						amount: toDecimalString(record),
						...(range === undefined ? {} : { expected_amount_range: range }),
						currency: record.currency,
						status: record.status,
						expected_day_of_month: record.expectedDayOfMonth,
						next_expected_date: record.nextExpectedDate,
						last_occurrence_date: record.lastOccurrenceDate,
						occurrence_count: record.occurrenceCount,
						is_manual: record.manual,
						account: { id: record.accountId, name: record.accountName },
						merchant:
							record.merchantId === null
								? null
								: { id: record.merchantId, name: record.merchantName ?? record.merchantId },
					};
				}),
				totals_by_currency: totalsByCurrency(records),
			},
			changedRows: 0,
		};
	},
});
