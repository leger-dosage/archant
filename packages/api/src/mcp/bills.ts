import type { BillView, OccurrenceView } from "../services/recurring/bill-reads.ts";
import type { PriceChange } from "../services/recurring/bills.ts";
import type { RecordedOccurrence } from "../services/recurring/payments.ts";
import type { RecurringRecord } from "../services/recurring/series.ts";

import { z } from "zod";

import type { MinorUnits } from "@archant/data/money";
import { toDecimalString, toMinorUnits } from "@archant/data/money";
import {
	ALLOCATION_SOURCES,
	ALLOCATION_STATES,
	BILL_TYPES,
	OCCURRENCE_STATUSES,
} from "@archant/data/recurring";

import { today } from "../domain/dates.ts";
import { nextDueDateOf, nextDueDates } from "../domain/recurring/bills.ts";
import { CUSTOM_PRESET, FREQUENCY_PRESETS } from "../domain/recurring/frequency.ts";
import { monthlyEquivalent } from "../domain/recurring/schedule.ts";
import {
	billAuditInput,
	billIdInput,
	createBillInput,
	getBillsInput,
	recordBillPaymentInput,
	updateBillInput,
} from "../schemas/assistants.ts";
import { billStatusSchema } from "../schemas/bills.ts";
import { billAudit } from "../services/recurring/audit.ts";
import {
	billHistory,
	STORED_STATUS,
	findBills,
	lifecycleOf,
} from "../services/recurring/bill-reads.ts";
import { declareBill, displayName, updateBill } from "../services/recurring/bills.ts";
import { recordBillPayment } from "../services/recurring/payments.ts";
import {
	BANK_TEXT,
	CREATES,
	READ_ONLY,
	SETS,
	defineTool,
	leftOutFields,
	leftOutOf,
} from "./tool.ts";

/** A household has a few dozen bills; past this many, the assistant narrows its filter. */
const MAX_BILLS = 100;

/** An amount the type gives the direction of: a magnitude, never signed. */
const magnitude = (what: string) =>
	z
		.string()
		.describe(`${what}, a positive decimal string such as "13.49" in the currency beside it.`);

const positive = (amount: MinorUnits, currency: string) =>
	toDecimalString({ amount: toMinorUnits(Math.abs(amount)), currency });

const DERIVED_STATES = [
	"upcoming",
	"due",
	"overdue",
	...OCCURRENCE_STATUSES.filter((status) => status !== "scheduled"),
] as const;

const billOutput = z.object({
	id: z.string(),
	name: z.string().describe("The owner's name for it, else the merchant's, else the bank label."),
	bill_type: z
		.enum(BILL_TYPES)
		.describe(
			'The direction comes from it: "income" is money coming in, any other money going out.',
		),
	status: billStatusSchema.describe(
		'"suggested": found by Archant, awaiting the owner, not a bill yet.',
	),
	amount: magnitude("Each occurrence's amount"),
	amount_min: magnitude("The lowest amount seen, only when they vary").optional(),
	amount_max: magnitude("The highest amount seen, only when they vary").optional(),
	currency: z.string(),
	frequency: z
		.enum([...FREQUENCY_PRESETS, CUSTOM_PRESET])
		.describe('"custom": a cadence no preset names, such as every 5 weeks.'),
	next_due_date: z
		.string()
		.describe("YYYY-MM-DD: the current open occurrence's, else the next expected one."),
	autopay: z.boolean(),
	detected_automatically: z.boolean().describe("false when the owner declared it."),
	account_id: z.string(),
	account_name: z.string(),
	category_id: z.string().nullable(),
	monthly_equivalent: magnitude("Its cost a month, whatever its cadence"),
	payment_url: z.string().nullable(),
});

const occurrenceFields = {
	due_on: z.string(),
	effective_due_on: z.string().describe("The due date, or a later one the owner postponed it to."),
	state: z
		.enum(DERIVED_STATES)
		.describe(
			"upcoming, due (from three days before), overdue (three days after), or once closed paid, skipped or missed.",
		),
	expected: magnitude("What it expects"),
	paid: magnitude("What its confirmed payments sum to"),
	remaining: magnitude("What is left to pay"),
	partially_paid: z.boolean(),
};

const occurrenceOutput = z.object(occurrenceFields);

/**
 * A series as the bill tools write it, from what a write returns as well as
 * from a read: its name, next due date and monthly equivalent computed as
 * « Toutes les factures » computes them.
 */
function billOf(bill: RecurringRecord): z.input<typeof billOutput> {
	const band =
		bill.expectedAmountMin !== null &&
		bill.expectedAmountMax !== null &&
		bill.expectedAmountMin !== bill.expectedAmountMax
			? [Math.abs(bill.expectedAmountMin), Math.abs(bill.expectedAmountMax)].toSorted(
					(a, b) => a - b,
				)
			: null;

	return {
		id: bill.id,
		name: displayName(bill),
		bill_type: bill.billType,
		status: lifecycleOf(bill.status),
		amount: positive(bill.amount, bill.currency),
		...(band === null
			? {}
			: {
					amount_min: positive(toMinorUnits(band[0]!), bill.currency),
					amount_max: positive(toMinorUnits(band[1]!), bill.currency),
				}),
		currency: bill.currency,
		frequency: bill.frequency.key === "interval" ? CUSTOM_PRESET : bill.frequency.key,
		next_due_date: nextDueDateOf(bill),
		autopay: bill.autopay,
		detected_automatically: !bill.manual,
		account_id: bill.accountId,
		account_name: bill.accountName,
		category_id: bill.categoryId,
		monthly_equivalent: positive(monthlyEquivalent(bill.rules, bill.amount), bill.currency),
		payment_url: bill.paymentUrl,
	};
}

/** Sure's `serialize_occurrence`. */
function occurrenceOf(
	occurrence: OccurrenceView & { open: boolean },
): z.input<typeof occurrenceOutput> {
	const { currency } = occurrence;

	return {
		due_on: occurrence.dueOn,
		effective_due_on: occurrence.effectiveDueOn,
		state: occurrence.state,
		expected: positive(occurrence.expected, currency),
		paid: positive(occurrence.paid, currency),
		remaining: positive(occurrence.remaining, currency),
		partially_paid: occurrence.open && occurrence.paid > 0 && occurrence.paid < occurrence.expected,
	};
}

/** A bill's current occurrence, read from what « Toutes les factures » computes. */
function currentOf(bill: BillView): z.input<typeof occurrenceOutput> | null {
	const occurrence = bill.currentOccurrence;

	return occurrence === null
		? null
		: occurrenceOf({
				dueOn: occurrence.dueOn,
				effectiveDueOn: occurrence.effectiveDueOn,
				state: occurrence.state,
				expected: occurrence.expected,
				paid: occurrence.confirmed,
				remaining: occurrence.remaining,
				currency: bill.currency,
				open: occurrence.status === "scheduled",
			});
}

const priceChangeOutput = z.object({
	bill_id: z.string(),
	name: z.string(),
	effective_on: z.string(),
	previous_amount: magnitude("The amount before"),
	new_amount: magnitude("The amount after"),
	currency: z.string(),
	percent_change: z.number().describe("Signed, to one decimal: 18.5 is a rise of 18.5 %."),
});

function priceChangeOf(change: PriceChange): z.input<typeof priceChangeOutput> {
	return {
		bill_id: change.seriesId,
		name: change.name,
		effective_on: change.effectiveOn,
		previous_amount: positive(change.previousAmount, change.currency),
		new_amount: positive(change.newAmount, change.currency),
		currency: change.currency,
		percent_change: change.percent / 10,
	};
}

export const getBills = defineTool({
	name: "get_bills",
	title: "Bills",
	description: `The bills, subscriptions and incomes the owner follows, as « Factures » lists them, by next due date, each with its current occurrence's payment state and monthly equivalent. Amounts are positive: bill_type carries the direction. A suggested bill is a pattern Archant found, not a bill until the owner adds it. The totals cover every match, not only the bills shown, and leave out the incomes. Use get_bill_details for one bill's history. ${BANK_TEXT}`,
	scope: "archant:read",
	annotations: READ_ONLY,
	input: getBillsInput,
	output: z.object({
		bills: z.array(
			billOutput.extend({
				current_occurrence: occurrenceOutput
					.nullable()
					.describe("The earliest open occurrence, else the latest; null before the first."),
			}),
		),
		total_results: z.number().int().describe("Every matching bill."),
		truncated: z.boolean().describe(`true when more than ${MAX_BILLS} match.`),
		totals: z
			.object({
				currency: z.string().describe("The reporting currency of the sum."),
				active_count: z.number().int(),
				overdue_count: z
					.number()
					.int()
					.describe("Matching bills whose current occurrence is overdue."),
				active_monthly_equivalent: magnitude(
					"What the active bills but the incomes cost a month, in the reporting currency",
				),
				...leftOutFields,
			})
			.describe(
				"left_out_count and left_out_account_ids concern active_monthly_equivalent only: the counts include bills in every currency.",
			),
	}),
	run: async (deps, input) => {
		const found = await findBills(deps, {
			status: input.status,
			paymentState: input.payment_state,
			billType: input.bill_type,
			search: input.search,
			dueWithinDays: input.due_within_days,
		});

		return {
			result: {
				bills: found.bills
					.slice(0, MAX_BILLS)
					.map((bill) => ({ ...billOf(bill), current_occurrence: currentOf(bill) })),
				total_results: found.bills.length,
				truncated: found.bills.length > MAX_BILLS,
				totals: {
					currency: found.totals.currency,
					active_count: found.totals.activeCount,
					overdue_count: found.totals.overdueCount,
					active_monthly_equivalent: positive(found.totals.activeMonthly, found.totals.currency),
					...leftOutOf(found.totals.leftOut),
				},
			},
			changedRows: 0,
		};
	},
});

export const getBillDetails = defineTool({
	name: "get_bill_details",
	title: "One bill",
	description: `One bill's whole story, as its page tells it: its configuration and schedule, its open occurrences, its twelve latest closed occurrences with their payments, its next three due dates and its price changes of the last 24 months. closed_count says how many closed occurrences there are in all: do not present the twelve as a lifetime total. ${BANK_TEXT}`,
	scope: "archant:read",
	annotations: READ_ONLY,
	input: billIdInput,
	output: z.object({
		bill: billOutput.extend({
			anchor_date: z.string().nullable().describe("The date the schedule counts from."),
			end_after_count: z.number().int().nullable().describe("An installment's number of payments."),
			notes: z.string().nullable(),
			schedule_pinned: z
				.boolean()
				.describe("true once the owner set the cadence: detection never moves its day."),
		}),
		open_occurrences: z.array(occurrenceOutput),
		closed_occurrences: z
			.array(
				occurrenceOutput.extend({
					status: z.enum(OCCURRENCE_STATUSES),
					payments: z.array(
						z.object({
							amount: magnitude("What it pays"),
							paid_on: z.string().nullable(),
							source: z
								.enum(ALLOCATION_SOURCES)
								.describe(
									'"auto_matched": found by Archant; "user_confirmed": accepted by the owner; "user_created": recorded by hand, with no transaction.',
								),
							state: z
								.enum(ALLOCATION_STATES)
								.describe('"suggested" awaits the owner and does not count.'),
							transaction_id: z.string().nullable(),
							transaction_label: z.string().nullable(),
						}),
					),
				}),
			)
			.describe("The latest first, twelve at most."),
		closed_count: z.number().int(),
		upcoming_due_dates: z.array(z.string()).describe("The next three after today."),
		price_changes: z.array(priceChangeOutput).describe("The latest first."),
	}),
	run: async (deps, { bill_id: billId }) => {
		const history = await billHistory(deps, billId);
		const { bill } = history;

		return {
			result: {
				bill: {
					...billOf(bill),
					anchor_date: bill.anchorDate,
					end_after_count: bill.endAfterCount,
					notes: bill.notes,
					schedule_pinned: bill.schedulePinned,
				},
				open_occurrences: history.open.map((row) => occurrenceOf({ ...row, open: true })),
				closed_occurrences: history.closed.map((row) => ({
					...occurrenceOf({ ...row, open: false }),
					status: row.status,
					payments: row.payments.map((payment) => ({
						amount: positive(payment.amount, row.currency),
						paid_on: payment.paidOn,
						source: payment.source,
						state: payment.state,
						transaction_id: payment.transactionId,
						transaction_label: payment.transactionLabel,
					})),
				})),
				closed_count: history.closedCount,
				upcoming_due_dates: history.nextDueDates,
				price_changes: history.priceChanges.map(priceChangeOf),
			},
			changedRows: 0,
		};
	},
});

const sectionOf = <Item extends z.ZodType>(item: Item, what: string) =>
	z
		.object({
			items: z.array(item).describe("The first twenty."),
			count: z.number().int().describe("Every one found."),
			truncated: z.boolean(),
		})
		.describe(what);

const billRef = {
	bill_id: z.string(),
	name: z.string(),
	account_id: z.string(),
	account_name: z.string(),
};

const refOf = (bill: BillView) => ({
	bill_id: bill.id,
	name: bill.displayName,
	account_id: bill.accountId,
	account_name: bill.accountName,
});

/** An audit section with each of its items as the tool writes it. */
const mapSection = <In, Out>(
	found: { items: In[]; count: number; truncated: boolean },
	item: (value: In) => Out,
) => ({ items: found.items.map(item), count: found.count, truncated: found.truncated });

export const getBillAudit = defineTool({
	name: "get_bill_audit",
	title: "Bills review",
	description: `The facts a review of the bills needs, each section computed by Archant: possible duplicates (same name, amount and due day, so two tiers of one service are never flagged), recent price changes, bills overdue by a whole cycle or more, paused bills still holding an unpaid occurrence, suggestions awaiting the owner, and recurring charges no bill follows yet. Narrate and rank the findings rather than recompute them, propose fixes, and ask before changing anything. ${BANK_TEXT}`,
	scope: "archant:read",
	annotations: READ_ONLY,
	input: billAuditInput,
	output: z.object({
		possible_duplicates: sectionOf(
			z.object({
				name: z.string(),
				amount: magnitude("Their amount"),
				currency: z.string(),
				due_day: z.number().int().describe("Their expected day of the month."),
				bills: z.array(z.object(billRef)),
			}),
			"Groups of active bills sharing a name, an amount and a due day.",
		),
		price_changes: sectionOf(
			priceChangeOutput,
			"Of any bill since lookback_months, the latest first.",
		),
		long_overdue: sectionOf(
			z.object({
				...billRef,
				cycles_overdue: z
					.number()
					.int()
					.describe("Whole cycles of its own cadence since its due date."),
				next_due_date: z.string(),
				amount: magnitude("Its amount"),
				currency: z.string(),
			}),
			"Active bills but incomes a whole cycle or more past due, the most cycles first.",
		),
		dormant: sectionOf(
			z.object({ ...billRef, next_due_date: z.string() }),
			"Paused bills still holding an open occurrence.",
		),
		awaiting_confirmation: sectionOf(
			z.object({ ...billRef, amount: magnitude("Its amount"), currency: z.string() }),
			"Suggestions: patterns Archant found, not bills until the owner adds them.",
		),
		undeclared_candidates: sectionOf(
			z.object({
				name: z.string(),
				average_amount: magnitude("The mean of its charges"),
				currency: z.string(),
				account_id: z.string(),
				occurrence_count: z.number().int(),
				last_seen: z.string(),
				entry_id: z
					.string()
					.describe(
						"Its latest transaction: pass it to create_bill so the bill matches its bank lines.",
					),
			}),
			"Recurring charges no bill follows, as « Ajouter une facture » offers them, the latest first.",
		),
	}),
	run: async (deps, { lookback_months: lookbackMonths }) => {
		const audit = await billAudit(deps, lookbackMonths);

		return {
			result: {
				possible_duplicates: mapSection(audit.possibleDuplicates, (group) => ({
					name: group.name,
					amount: positive(group.amount, group.currency),
					currency: group.currency,
					due_day: group.expectedDayOfMonth,
					bills: group.bills.map(refOf),
				})),
				price_changes: mapSection(audit.priceChanges, priceChangeOf),
				long_overdue: mapSection(audit.longOverdue, ({ bill, cyclesOverdue }) => ({
					...refOf(bill),
					cycles_overdue: cyclesOverdue,
					next_due_date: bill.nextDueDate,
					amount: positive(bill.amount, bill.currency),
					currency: bill.currency,
				})),
				dormant: mapSection(audit.dormant, (bill) => ({
					...refOf(bill),
					next_due_date: bill.nextDueDate,
				})),
				awaiting_confirmation: mapSection(audit.awaitingConfirmation, (bill) => ({
					...refOf(bill),
					amount: positive(bill.amount, bill.currency),
					currency: bill.currency,
				})),
				undeclared_candidates: mapSection(audit.undeclaredCandidates, (candidate) => ({
					name: candidate.name,
					average_amount: positive(candidate.amount, candidate.currency),
					currency: candidate.currency,
					account_id: candidate.accountId,
					occurrence_count: candidate.occurrenceCount,
					last_seen: candidate.lastOccurrenceDate,
					entry_id: candidate.entryId,
				})),
			},
			changedRows: 0,
		};
	},
});

export const createBillTool = defineTool({
	name: "create_bill",
	title: "Create a bill",
	description:
		"Declares a bill, a subscription, an installment plan or an income, as « Ajouter une facture » does: active at once, due on first_due_on and then on its cadence. The amount is positive; is_income makes it money coming in. The same account, name and amount twice answers RECURRING_ALREADY_EXISTS. It answers the bill and its next three due dates. Tell the owner what you are about to create and wait for their agreement first.",
	scope: "archant:write",
	annotations: CREATES,
	input: createBillInput,
	output: z.object({
		bill: billOutput,
		upcoming_due_dates: z.array(z.string()).describe("The next three from today."),
	}),
	run: async (deps, input) => {
		const created = await declareBill(deps, {
			name: input.name,
			amount: input.amount,
			firstDueOn: input.first_due_on,
			accountId: input.account_id,
			kind: input.is_income ? "income" : "bill",
			frequency: { preset: input.frequency },
			billType: input.bill_type,
			categoryId: input.category_id,
			entryId: input.entry_id,
			autopay: input.autopay,
			paymentUrl: input.payment_url,
			notes: input.notes,
		});

		return {
			result: {
				bill: billOf(created),
				upcoming_due_dates: nextDueDates(created, today(deps.timeZone)),
			},
			changedRows: 1,
		};
	},
});

const asText = (value: number | undefined) => (value === undefined ? undefined : String(value));

export const updateBillTool = defineTool({
	name: "update_bill",
	title: "Update a bill",
	description:
		"Changes a bill as its edit dialog does, and pauses or resumes it, in one write: a refusal anywhere changes nothing. Only the fields given change. A new amount applies from now on: occurrences already due keep theirs. A new frequency pins the schedule, so detection never moves its day. It answers the fields it set and the bill. Tell the owner what you are about to change and wait for their agreement first.",
	scope: "archant:write",
	annotations: SETS,
	input: updateBillInput,
	output: z.object({
		changed_fields: z
			.array(z.string())
			.describe("The fields this call gave, a status the bill already had included."),
		bill: billOutput,
	}),
	run: async (deps, input) => {
		const {
			bill_id: billId,
			status,
			frequency,
			due_day_of_month: dueDayOfMonth,
			weekday,
			month_of_year: monthOfYear,
		} = input;
		const edit = {
			name: input.name,
			amount: input.amount,
			accountId: input.account_id,
			categoryId: input.category_id,
			billType: input.bill_type,
			autopay: input.autopay,
			paymentUrl: input.payment_url,
			notes: input.notes,
		};
		const updated = await updateBill(deps, billId, {
			...edit,
			...(frequency === undefined
				? {}
				: {
						frequency: {
							preset: frequency,
							dayOfMonth: asText(dueDayOfMonth),
							weekday: asText(weekday),
							monthOfYear: asText(monthOfYear),
						},
					}),
			...(status === undefined ? {} : { status: STORED_STATUS[status] }),
		});
		const { bill_id: _billId, ...given } = input;

		return {
			result: {
				changed_fields: Object.entries(given)
					.filter(([, value]) => value !== undefined)
					.map(([key]) => key),
				bill: billOf(updated),
			},
			changedRows: 1,
		};
	},
});

export const recordBillPaymentTool = defineTool({
	name: "record_bill_payment",
	title: "Record a bill payment",
	description:
		"Records a payment toward one of a bill's open occurrences, the current one unless occurrence_due_on names another. Without amount it settles what remains, as « Marquer comme payée » does, and refuses an occurrence not yet due unless occurrence_due_on names it, so a retry never pays next month; with amount it adds a partial payment, at most what remains. It never links a bank transaction: Archant's matching and the review queue on « Factures » do. Tell the owner what you are about to record and wait for their agreement first; if it was recorded already, do not retry.",
	scope: "archant:write",
	annotations: CREATES,
	input: recordBillPaymentInput,
	output: z.object({
		bill_id: z.string(),
		occurrence: occurrenceOutput.extend({ status: z.enum(OCCURRENCE_STATUSES) }),
	}),
	run: async (
		deps,
		{ bill_id: billId, occurrence_due_on: occurrenceDueOn, amount, paid_on: paidOn },
	) => {
		const occurrence: RecordedOccurrence = await recordBillPayment(deps, billId, {
			occurrenceDueOn,
			amount,
			paidOn,
		});

		return {
			result: {
				bill_id: billId,
				occurrence: {
					...occurrenceOf({ ...occurrence, open: occurrence.status === "scheduled" }),
					status: occurrence.status,
				},
			},
			changedRows: 1,
		};
	},
});
