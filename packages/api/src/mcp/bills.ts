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
	billType: z
		.enum(BILL_TYPES)
		.describe(
			'The direction comes from it: "income" is money coming in, any other money going out.',
		),
	status: billStatusSchema.describe(
		'"suggested": found by Archant, awaiting the owner, not a bill yet.',
	),
	amount: magnitude("Each occurrence's amount"),
	amountMin: magnitude("The lowest amount seen, only when they vary").optional(),
	amountMax: magnitude("The highest amount seen, only when they vary").optional(),
	currency: z.string(),
	frequency: z
		.enum([...FREQUENCY_PRESETS, CUSTOM_PRESET])
		.describe('"custom": a cadence no preset names, such as every 5 weeks.'),
	nextDueDate: z
		.string()
		.describe("YYYY-MM-DD: the current open occurrence's, else the next expected one."),
	autopay: z.boolean(),
	detectedAutomatically: z.boolean().describe("false when the owner declared it."),
	accountId: z.string(),
	accountName: z.string(),
	categoryId: z.string().nullable(),
	monthlyEquivalent: magnitude("Its cost a month, whatever its cadence"),
	paymentUrl: z.string().nullable(),
});

const occurrenceFields = {
	dueOn: z.string(),
	effectiveDueOn: z.string().describe("The due date, or a later one the owner postponed it to."),
	state: z
		.enum(DERIVED_STATES)
		.describe(
			"upcoming, due (from three days before), overdue (three days after), or once closed paid, skipped or missed.",
		),
	expected: magnitude("What it expects"),
	paid: magnitude("What its confirmed payments sum to"),
	remaining: magnitude("What is left to pay"),
	partiallyPaid: z.boolean(),
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
		billType: bill.billType,
		status: lifecycleOf(bill.status),
		amount: positive(bill.amount, bill.currency),
		...(band === null
			? {}
			: {
					amountMin: positive(toMinorUnits(band[0]!), bill.currency),
					amountMax: positive(toMinorUnits(band[1]!), bill.currency),
				}),
		currency: bill.currency,
		frequency: bill.frequency.key === "interval" ? CUSTOM_PRESET : bill.frequency.key,
		nextDueDate: nextDueDateOf(bill),
		autopay: bill.autopay,
		detectedAutomatically: !bill.manual,
		accountId: bill.accountId,
		accountName: bill.accountName,
		categoryId: bill.categoryId,
		monthlyEquivalent: positive(monthlyEquivalent(bill.rules, bill.amount), bill.currency),
		paymentUrl: bill.paymentUrl,
	};
}

/** Sure's `serialize_occurrence`. */
function occurrenceOf(
	occurrence: OccurrenceView & { open: boolean },
): z.input<typeof occurrenceOutput> {
	const { currency } = occurrence;

	return {
		dueOn: occurrence.dueOn,
		effectiveDueOn: occurrence.effectiveDueOn,
		state: occurrence.state,
		expected: positive(occurrence.expected, currency),
		paid: positive(occurrence.paid, currency),
		remaining: positive(occurrence.remaining, currency),
		partiallyPaid: occurrence.open && occurrence.paid > 0 && occurrence.paid < occurrence.expected,
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
	billId: z.string(),
	name: z.string(),
	effectiveOn: z.string(),
	previousAmount: magnitude("The amount before"),
	newAmount: magnitude("The amount after"),
	currency: z.string(),
	changePercent: z.number().describe("Signed, to one decimal: 18.5 is a rise of 18.5 %."),
});

function priceChangeOf(change: PriceChange): z.input<typeof priceChangeOutput> {
	return {
		billId: change.seriesId,
		name: change.name,
		effectiveOn: change.effectiveOn,
		previousAmount: positive(change.previousAmount, change.currency),
		newAmount: positive(change.newAmount, change.currency),
		currency: change.currency,
		changePercent: change.percent / 10,
	};
}

export const getBills = defineTool({
	name: "get_bills",
	title: "Bills",
	description: `The bills, subscriptions and incomes the owner follows, as « Factures » lists them, by next due date, each with its current occurrence's payment state and monthly equivalent. Amounts are positive: billType carries the direction. A suggested bill is a pattern Archant found, not a bill until the owner adds it. The totals cover every match, not only the bills shown, and leave out the incomes. Use get_bill_details for one bill's history. ${BANK_TEXT}`,
	scope: "archant:read",
	annotations: READ_ONLY,
	input: getBillsInput,
	output: z.object({
		bills: z.array(
			billOutput.extend({
				currentOccurrence: occurrenceOutput
					.nullable()
					.describe("The earliest open occurrence, else the latest; null before the first."),
			}),
		),
		total: z.number().int().describe("Every matching bill."),
		truncated: z.boolean().describe(`true when more than ${MAX_BILLS} match.`),
		totals: z
			.object({
				currency: z.string().describe("The reporting currency of the sum."),
				activeCount: z.number().int(),
				overdueCount: z
					.number()
					.int()
					.describe("Matching bills whose current occurrence is overdue."),
				activeMonthlyEquivalent: magnitude(
					"What the active bills but the incomes cost a month, in the reporting currency",
				),
				...leftOutFields,
			})
			.describe(
				"leftOutCount and leftOutAccountIds concern activeMonthlyEquivalent only: the counts include bills in every currency.",
			),
	}),
	run: async (deps, input) => {
		const found = await findBills(deps, input);

		return {
			result: {
				bills: found.bills
					.slice(0, MAX_BILLS)
					.map((bill) => ({ ...billOf(bill), currentOccurrence: currentOf(bill) })),
				total: found.bills.length,
				truncated: found.bills.length > MAX_BILLS,
				totals: {
					currency: found.totals.currency,
					activeCount: found.totals.activeCount,
					overdueCount: found.totals.overdueCount,
					activeMonthlyEquivalent: positive(found.totals.activeMonthly, found.totals.currency),
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
	description: `One bill's whole story, as its page tells it: its configuration and schedule, its open occurrences, its twelve latest closed occurrences with their payments, its next three due dates and its price changes of the last 24 months. closedCount says how many closed occurrences there are in all: do not present the twelve as a lifetime total. ${BANK_TEXT}`,
	scope: "archant:read",
	annotations: READ_ONLY,
	input: billIdInput,
	output: z.object({
		bill: billOutput.extend({
			anchorDate: z.string().nullable().describe("The date the schedule counts from."),
			endAfterCount: z.number().int().nullable().describe("An installment's number of payments."),
			notes: z.string().nullable(),
			schedulePinned: z
				.boolean()
				.describe("true once the owner set the cadence: detection never moves its day."),
		}),
		openOccurrences: z.array(occurrenceOutput),
		closedOccurrences: z
			.array(
				occurrenceOutput.extend({
					status: z.enum(OCCURRENCE_STATUSES),
					payments: z.array(
						z.object({
							amount: magnitude("What it pays"),
							paidOn: z.string().nullable(),
							source: z
								.enum(ALLOCATION_SOURCES)
								.describe(
									'"auto_matched": found by Archant; "user_confirmed": accepted by the owner; "user_created": recorded by hand, with no transaction.',
								),
							state: z
								.enum(ALLOCATION_STATES)
								.describe('"suggested" awaits the owner and does not count.'),
							transactionId: z.string().nullable(),
							transactionLabel: z.string().nullable(),
						}),
					),
				}),
			)
			.describe("The latest first, twelve at most."),
		closedCount: z.number().int(),
		nextDueDates: z.array(z.string()).describe("The next three after today."),
		priceChanges: z.array(priceChangeOutput).describe("The latest first."),
	}),
	run: async (deps, { billId }) => {
		const history = await billHistory(deps, billId);
		const { bill } = history;

		return {
			result: {
				bill: {
					...billOf(bill),
					anchorDate: bill.anchorDate,
					endAfterCount: bill.endAfterCount,
					notes: bill.notes,
					schedulePinned: bill.schedulePinned,
				},
				openOccurrences: history.open.map((row) => occurrenceOf({ ...row, open: true })),
				closedOccurrences: history.closed.map((row) => ({
					...occurrenceOf({ ...row, open: false }),
					status: row.status,
					payments: row.payments.map((payment) => ({
						...payment,
						amount: positive(payment.amount, row.currency),
					})),
				})),
				closedCount: history.closedCount,
				nextDueDates: history.nextDueDates,
				priceChanges: history.priceChanges.map(priceChangeOf),
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
	billId: z.string(),
	name: z.string(),
	accountId: z.string(),
	accountName: z.string(),
};

const refOf = (bill: BillView) => ({
	billId: bill.id,
	name: bill.displayName,
	accountId: bill.accountId,
	accountName: bill.accountName,
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
		possibleDuplicates: sectionOf(
			z.object({
				name: z.string(),
				amount: magnitude("Their amount"),
				currency: z.string(),
				dueDay: z.number().int().describe("Their expected day of the month."),
				bills: z.array(z.object(billRef)),
			}),
			"Groups of active bills sharing a name, an amount and a due day.",
		),
		priceChanges: sectionOf(
			priceChangeOutput,
			"Of any bill since lookbackMonths, the latest first.",
		),
		longOverdue: sectionOf(
			z.object({
				...billRef,
				cyclesOverdue: z
					.number()
					.int()
					.describe("Whole cycles of its own cadence since its due date."),
				nextDueDate: z.string(),
				amount: magnitude("Its amount"),
				currency: z.string(),
			}),
			"Active bills but incomes a whole cycle or more past due, the most cycles first.",
		),
		dormant: sectionOf(
			z.object({ ...billRef, nextDueDate: z.string() }),
			"Paused bills still holding an open occurrence.",
		),
		awaitingConfirmation: sectionOf(
			z.object({ ...billRef, amount: magnitude("Its amount"), currency: z.string() }),
			"Suggestions: patterns Archant found, not bills until the owner adds them.",
		),
		undeclaredCandidates: sectionOf(
			z.object({
				name: z.string(),
				averageAmount: magnitude("The mean of its charges"),
				currency: z.string(),
				accountId: z.string(),
				occurrenceCount: z.number().int(),
				lastSeen: z.string(),
				entryId: z
					.string()
					.describe(
						"Its latest transaction: pass it to create_bill so the bill matches its bank lines.",
					),
			}),
			"Recurring charges no bill follows, as « Ajouter une facture » offers them, the latest first.",
		),
	}),
	run: async (deps, { lookbackMonths }) => {
		const audit = await billAudit(deps, lookbackMonths);

		return {
			result: {
				possibleDuplicates: mapSection(audit.possibleDuplicates, (group) => ({
					name: group.name,
					amount: positive(group.amount, group.currency),
					currency: group.currency,
					dueDay: group.expectedDayOfMonth,
					bills: group.bills.map(refOf),
				})),
				priceChanges: mapSection(audit.priceChanges, priceChangeOf),
				longOverdue: mapSection(audit.longOverdue, ({ bill, cyclesOverdue }) => ({
					...refOf(bill),
					cyclesOverdue,
					nextDueDate: bill.nextDueDate,
					amount: positive(bill.amount, bill.currency),
					currency: bill.currency,
				})),
				dormant: mapSection(audit.dormant, (bill) => ({
					...refOf(bill),
					nextDueDate: bill.nextDueDate,
				})),
				awaitingConfirmation: mapSection(audit.awaitingConfirmation, (bill) => ({
					...refOf(bill),
					amount: positive(bill.amount, bill.currency),
					currency: bill.currency,
				})),
				undeclaredCandidates: mapSection(audit.undeclaredCandidates, (candidate) => ({
					name: candidate.name,
					averageAmount: positive(candidate.amount, candidate.currency),
					currency: candidate.currency,
					accountId: candidate.accountId,
					occurrenceCount: candidate.occurrenceCount,
					lastSeen: candidate.lastOccurrenceDate,
					entryId: candidate.entryId,
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
		"Declares a bill, a subscription, an installment plan or an income, as « Ajouter une facture » does: active at once, due on firstDueOn and then on its cadence. The amount is positive; isIncome makes it money coming in. The same account, name and amount twice answers RECURRING_ALREADY_EXISTS. It answers the bill and its next three due dates. Tell the owner what you are about to create and wait for their agreement first.",
	scope: "archant:write",
	annotations: CREATES,
	input: createBillInput,
	output: z.object({
		bill: billOutput,
		nextDueDates: z.array(z.string()).describe("The next three from today."),
	}),
	run: async (deps, { isIncome, frequency, ...input }) => {
		const created = await declareBill(deps, {
			...input,
			kind: isIncome ? "income" : "bill",
			frequency: { preset: frequency },
		});

		return {
			result: {
				bill: billOf(created),
				nextDueDates: nextDueDates(created, today(deps.timeZone)),
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
		changedFields: z
			.array(z.string())
			.describe("The fields this call gave, a status the bill already had included."),
		bill: billOutput,
	}),
	run: async (
		deps,
		{ billId, status, frequency, dueDayOfMonth, weekday, monthOfYear, ...edit },
	) => {
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
		const given = { ...edit, status, frequency, dueDayOfMonth, weekday, monthOfYear };

		return {
			result: {
				changedFields: Object.entries(given)
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
		"Records a payment toward one of a bill's open occurrences, the current one unless occurrenceDueOn names another. Without amount it settles what remains, as « Marquer comme payée » does, and refuses an occurrence not yet due unless occurrenceDueOn names it, so a retry never pays next month; with amount it adds a partial payment, at most what remains. It never links a bank transaction: Archant's matching and the review queue on « Factures » do. Tell the owner what you are about to record and wait for their agreement first; if it was recorded already, do not retry.",
	scope: "archant:write",
	annotations: CREATES,
	input: recordBillPaymentInput,
	output: z.object({
		billId: z.string(),
		occurrence: occurrenceOutput.extend({ status: z.enum(OCCURRENCE_STATUSES) }),
	}),
	run: async (deps, { billId, ...input }) => {
		const occurrence: RecordedOccurrence = await recordBillPayment(deps, billId, input);

		return {
			result: {
				billId,
				occurrence: {
					...occurrenceOf({ ...occurrence, open: occurrence.status === "scheduled" }),
					status: occurrence.status,
				},
			},
			changedRows: 1,
		};
	},
});
