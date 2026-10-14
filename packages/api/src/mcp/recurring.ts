import type { RecurringRecord } from "../services/recurring/series.ts";

import { z } from "zod";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { RECURRING_STATUSES } from "@archant/data/schema/recurring-transactions";

import { today } from "../domain/dates.ts";
import { displayName } from "../domain/recurring/bills.ts";
import { recurringInput } from "../schemas/assistants/recurring.ts";
import { listRecurring } from "../services/recurring/series.ts";
import { BANK_TEXT, READ_ONLY, defineTool, formatMoney, formatted, namedRef } from "./tool.ts";

// Sure's `MAX_RESULTS`.
const MAX_RECURRING = 200;

/** An amount in Sure's sign, an expense positive and an income negative, formatted. */
const sureSigned = (amount: MinorUnits, currency: string) =>
	formatMoney({ amount: toMinorUnits(0 - amount), currency });

/**
 * Sure's `expected_amount_range` in Sure's sign, which swaps the bounds: an
 * expense's lowest in Sure's sign is Archant's highest negated. Absent when
 * neither is known.
 */
function rangeOf(record: RecurringRecord): string[] | undefined {
	const range = [record.expectedAmountMax, record.expectedAmountMin].flatMap((bound) =>
		bound === null ? [] : [sureSigned(bound, record.currency)],
	);

	return range.length === 0 ? undefined : range;
}

/**
 * Sure's `upcoming_within_days`: a blank value is none, any other is read as
 * Ruby's `to_i`, its leading whole number or 0, then held within 1 and 365.
 */
function daysOf(value: string | number | null | undefined): number | undefined {
	if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
		return undefined;
	}

	const days =
		typeof value === "number"
			? Math.trunc(value)
			: Number(/^\s*([+-]?\d+)/u.exec(value)?.[1] ?? "0");

	return Math.min(365, Math.max(1, Number.isFinite(days) ? days : 1));
}

/**
 * Sure's `totals_by_currency`: the active series' amounts in Sure's sign,
 * summed in each currency over every match, recurring transfers left out:
 * money moving between the household's own accounts is no recurring spend.
 */
function totalsByCurrency(records: readonly RecurringRecord[]): Record<string, string> {
	const sums = new Map<string, MinorUnits>();

	for (const record of records.filter(
		(item) => item.status === "active" && item.destinationAccountId === null,
	)) {
		sums.set(record.currency, toMinorUnits((sums.get(record.currency) ?? 0) + record.amount));
	}

	return Object.fromEntries(
		[...sums].map(([currency, amount]) => [currency, sureSigned(amount, currency)]),
	);
}

export const getRecurringTransactions = defineTool({
	name: "get_recurring_transactions",
	title: "Recurring transactions",
	description: `Lists detected and manual recurring transactions (subscriptions, salaries, recurring bills and transfers) with expected amounts and next expected dates, as « Récurrents » lists them. Amounts are formatted in Sure's sign: an expense positive, an income negative. status defaults to "active"; "all" lists every series, suggested and ended ones included. Pass upcoming_within_days to only see items expected between today and that many days from now (overdue items appear when no window is given). totals_by_currency sums the active items excluding transfers, which move money between the owner's own accounts. ${BANK_TEXT}`,
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
				amount: formatted("Its expected amount, positive for an expense, negative for an income"),
				expected_amount_range: z
					.array(z.string())
					.optional()
					.describe("The lowest and highest amounts seen, in the same sign; absent when unknown."),
				currency: z.string(),
				status: z
					.enum(RECURRING_STATUSES)
					.describe(
						'"suggested": found by Archant, awaiting the owner; "active": followed by the owner; "inactive": paused or retired; "ended": dismissed or finished.',
					),
				expected_day_of_month: z.number().int(),
				next_expected_date: z.string(),
				last_occurrence_date: z.string(),
				occurrence_count: z.number().int(),
				is_manual: z.boolean().describe("Added by the owner."),
				is_transfer: z
					.boolean()
					.describe("A recurring transfer between two of the owner's accounts."),
				account: namedRef.optional().describe("Absent for a series paid from any account."),
				destination_account: namedRef
					.optional()
					.describe("The account a recurring transfer pays into; absent for any other series."),
			}),
		),
		totals_by_currency: z
			.record(z.string(), z.string())
			.describe(
				"Each currency's sum of the matching active series' amounts, in the same sign, over every match, not only those shown.",
			),
	}),
	run: async (deps, input) => {
		const records = await listRecurring(deps, {
			status: input.status,
			withinDays: daysOf(input.upcoming_within_days),
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
						amount: sureSigned(record.amount, record.currency),
						...(range === undefined ? {} : { expected_amount_range: range }),
						currency: record.currency,
						status: record.status,
						expected_day_of_month: record.expectedDayOfMonth,
						next_expected_date: record.nextExpectedDate,
						last_occurrence_date: record.lastOccurrenceDate,
						occurrence_count: record.occurrenceCount,
						is_manual: record.manual,
						is_transfer: record.destinationAccountId !== null,
						...(record.accountId === null
							? {}
							: { account: { id: record.accountId, name: record.accountName ?? "" } }),
						...(record.destinationAccountId === null
							? {}
							: {
									destination_account: {
										id: record.destinationAccountId,
										name: record.destinationAccountName ?? "",
									},
								}),
					};
				}),
				totals_by_currency: totalsByCurrency(records),
			},
			changedRows: 0,
		};
	},
});
