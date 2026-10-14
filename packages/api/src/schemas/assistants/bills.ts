import { z } from "zod";

import { FREQUENCY_PRESETS } from "../bills.ts";
import { looseBoolean, looseInteger, requiredLoose, sureAmount } from "./fields.ts";

const billId = requiredLoose(z.string()).describe(
	"The bill's id, exactly as returned by get_bills.",
);

/**
 * `get_bills`: Sure's `GetBills` filters, loosely typed as Sure's: `run`
 * refuses an unknown status, type or payment state, and a range outside 1 to
 * 365, with Sure's messages.
 */
export const getBillsInput = z.strictObject({
	status: z
		.string()
		.nullable()
		.optional()
		.describe(
			'Series lifecycle filter, "active" by default: "active", "suggested" (found by Archant, awaiting the owner, not a bill yet), "paused" (set aside), "ended" (dismissed or finished), "all".',
		),
	payment_state: z
		.string()
		.nullable()
		.optional()
		.describe(
			'The current occurrence\'s state, applied after the status filter: "overdue", "due" (within three days of its date), "upcoming", "partial" (partly paid), "paid". Nobody is paying a paused or ended bill, so its unpaid occurrence is never overdue, due or upcoming.',
		),
	bill_type: z
		.string()
		.nullable()
		.optional()
		.describe(
			'The kind of recurring obligation: "bill", "subscription", "installment", "income" (a declared income, not something to pay), "other".',
		),
	search: z
		.string()
		.nullable()
		.optional()
		.describe("Substring match on the bill's name, its merchant's and its bank label, case aside."),
	due_within_days: looseInteger
		.nullable()
		.optional()
		.describe(
			"A whole number from 1 to 365: only bills whose next due date falls within this many days, overdue ones included.",
		),
});

export const billIdInput = z.strictObject({ bill_id: billId });

/** `get_bill_audit`: how far back price changes reach, checked by `run` as Sure's. */
export const billAuditInput = z.strictObject({
	lookback_months: looseInteger
		.nullable()
		.optional()
		.describe("A whole number from 1 to 24: how far back to report price changes, 12 by default."),
});

const frequencyText = z.string().nullable().optional();

/**
 * `create_bill`: Sure's `CreateBill` parameters, loosely typed as Sure's:
 * `run` reads the flags through Sure's allowlist, the account and the
 * category by their exact names, and refuses in Sure's order.
 */
export const createBillInput = z.strictObject({
	name: requiredLoose(z.string()).describe("What the owner calls this bill."),
	amount: requiredLoose(sureAmount).describe(
		'Positive magnitude per occurrence, a number or decimal string such as 13.49 or "13.49"; is_income gives the direction.',
	),
	first_due_on: requiredLoose(z.string()).describe(
		"Next due date, YYYY-MM-DD: its day of the month, weekday and month set the schedule's.",
	),
	frequency: frequencyText.describe(
		`Cadence, monthly by default: ${FREQUENCY_PRESETS.join(", ")}. Any other word is refused, "yearly" among them.`,
	),
	is_income: looseBoolean
		.nullable()
		.optional()
		.describe("true for a paycheck or another income: money coming in, never categorised."),
	bill_type: z
		.string()
		.nullable()
		.optional()
		.describe('"bill" by default, "subscription" or "installment"; ignored for an income.'),
	account_name: z
		.string()
		.nullable()
		.optional()
		.describe(
			"Exact account name from get_accounts. Omit it to create the bill paid from any account, in the reporting currency.",
		),
	category_name: z
		.string()
		.nullable()
		.optional()
		.describe("Exact category name from get_categories; ignored for an income."),
	autopay: looseBoolean.nullable().optional().describe("Paid by direct debit."),
	payment_url: z
		.string()
		.nullable()
		.optional()
		.describe("Where this bill gets paid, an http or https link; a bare host gets https://."),
	notes: z.string().nullable().optional(),
});

/**
 * `update_bill`: Sure's `UpdateBill` parameters, loosely typed as Sure's. A
 * key given changes its field, `null` included; `run` applies them in Sure's
 * steps and refuses at the first wrong one, writing nothing.
 */
export const updateBillInput = z.strictObject({
	bill_id: billId,
	name: z.string().nullable().optional().describe("Empty shows the merchant or label again."),
	amount: sureAmount
		.nullable()
		.optional()
		.describe(
			"New positive magnitude, a number or decimal string; it applies forward only: occurrences already due keep theirs.",
		),
	account_name: z.string().nullable().optional().describe("Exact account name from get_accounts."),
	category_name: z
		.string()
		.nullable()
		.optional()
		.describe('Exact category name from get_categories, or "Uncategorized" to clear it.'),
	bill_type: z
		.string()
		.nullable()
		.optional()
		.describe('"bill", "subscription" or "installment", for a bill of one of these kinds only.'),
	status: z
		.string()
		.nullable()
		.optional()
		.describe('"paused" sets the bill aside, with no new occurrences; "active" resumes it.'),
	frequency: frequencyText.describe(
		`New cadence, pinned against detection: ${FREQUENCY_PRESETS.join(", ")}. Combine with due_day_of_month, weekday or month_of_year as the cadence needs.`,
	),
	due_day_of_month: looseInteger
		.nullable()
		.optional()
		.describe("1 to 31, or -1 for the month's last day; only with frequency."),
	weekday: looseInteger.nullable().optional().describe("0 is Sunday; only with frequency."),
	month_of_year: looseInteger.nullable().optional().describe("1 to 12; only with frequency."),
	autopay: looseBoolean.nullable().optional(),
	payment_url: z.string().nullable().optional().describe("Empty or null removes it."),
	notes: z.string().nullable().optional().describe("Empty or null removes them."),
	renews_on: z
		.string()
		.nullable()
		.optional()
		.describe("YYYY-MM-DD. Archant keeps no renewal date yet: refused."),
	trial_ends_on: z
		.string()
		.nullable()
		.optional()
		.describe("YYYY-MM-DD. Archant keeps no trial end yet: refused."),
});

/** `record_bill_payment`: Sure's `RecordBillPayment` parameters, checked by `run` as Sure's. */
export const recordBillPaymentInput = z.strictObject({
	bill_id: billId,
	occurrence_due_on: z
		.string()
		.nullable()
		.optional()
		.describe(
			"Due date (YYYY-MM-DD) of the open occurrence to pay, as get_bill_details lists it. Defaults to the current one.",
		),
	amount: sureAmount
		.nullable()
		.optional()
		.describe(
			"Partial payment magnitude, a number or decimal string, at most what remains. Omit to settle in full.",
		),
	paid_on: z
		.string()
		.nullable()
		.optional()
		.describe("When it was paid, YYYY-MM-DD. Defaults to today."),
});
