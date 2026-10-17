import type { IsoDate } from "../domain/dates.ts";
import type { ErrorCode } from "../lib/errors.ts";
import type { ServiceDeps } from "../services/deps.ts";
import type { PriceChange } from "../services/recurring/all-bills.ts";
import type { BillHistory, BillView, OccurrenceView } from "../services/recurring/bill-reads.ts";
import type { RecurringRecord } from "../services/recurring/series.ts";

import { z } from "zod";

import type { MinorUnits } from "@archant/data/money";
import { parseAmount, toMinorUnits } from "@archant/data/money";
import {
	ALLOCATION_SOURCES,
	ALLOCATION_STATES,
	BILL_TYPES,
	OCCURRENCE_STATUSES,
} from "@archant/data/recurring";

import { today } from "../domain/dates.ts";
import { displayName, nextDueDateOf, nextDueDates } from "../domain/recurring/bills.ts";
import { CUSTOM_PRESET, FREQUENCY_PRESETS, applyFrequency } from "../domain/recurring/frequency.ts";
import { derivedState } from "../domain/recurring/occurrences.ts";
import { monthlyEquivalent } from "../domain/recurring/schedule.ts";
import { AppError } from "../lib/errors.ts";
import {
	billAuditInput,
	billIdInput,
	createBillInput,
	getBillsInput,
	recordBillPaymentInput,
	updateBillInput,
} from "../schemas/assistants/bills.ts";
import { BILL_LIFECYCLES, BILL_PAYMENT_STATES, billStatusSchema } from "../schemas/bills.ts";
import { accountsNamed, idsNamed, isUncategorisedName, namesOf } from "../services/names.ts";
import { billAudit } from "../services/recurring/audit.ts";
import { billHistory, billView, findBills, lifecycleOf } from "../services/recurring/bill-reads.ts";
import { declareBill, updateBill } from "../services/recurring/bills.ts";
import { recordBillPayment } from "../services/recurring/payments.ts";
import {
	BANK_TEXT,
	CREATES,
	RAILS_FALSE,
	READ_ONLY,
	SETS,
	UUID,
	defineTool,
	formatMoney,
	formatted,
	namedRef,
	refuseNoSuchRecord,
	refuseWithHint,
	sureDecimalText,
} from "./tool.ts";

// Sure's `MAX_RESULTS`, `HISTORY_LIMIT` and `PRICE_CHANGE_LOOKBACK_MONTHS`.
const MAX_BILLS = 100;
const HISTORY_LIMIT = 12;
const PRICE_CHANGE_MONTHS = 24;

/** Sure's `UpdateBill::EDITABLE_BILL_TYPES`: what a tool may set, and change from. */
const SURE_BILL_TYPES = ["bill", "subscription", "installment"] as const;

/** Sure's `FIX_HINT` of a write the model refuses. */
const FIX_HINT = "Fix the named fields and retry once.";

/** Sure's `RecordBillPayment::AMOUNT_HINT`. */
const AMOUNT_HINT =
	"Check the occurrence's remaining amount via get_bill_details and retry once with a valid amount.";

const DATE_HINT = "Use YYYY-MM-DD.";

/** Ruby's `blank?`: nothing, `false`, or text of spaces alone. */
const isBlank = (value: unknown) =>
	value === undefined ||
	value === null ||
	value === false ||
	(typeof value === "string" && value.trim() === "");

/** Ruby's `inspect` of an argument: a string quoted, `nil` for none. */
const inspect = (value: unknown) =>
	value === undefined || value === null ? "nil" : JSON.stringify(value);

/** Rails' `to_sentence`: "a", "a and b", "a, b, and c". */
function toSentence(words: readonly string[]): string {
	if (words.length < 3) {
		return words.join(" and ");
	}

	return `${words.slice(0, -1).join(", ")}, and ${words.at(-1)}`;
}

/** Ruby's `Integer(value.to_s, exception: false)`: a whole number, else `null`. */
function wholeNumberOf(value: unknown): number | null {
	if (typeof value === "number") {
		return Number.isSafeInteger(value) ? value : null;
	}

	const text = typeof value === "string" ? value.trim().replaceAll(/(?<=\d)_(?=\d)/gu, "") : "";

	return /^[+-]?\d+$/u.test(text) ? Number(text) : null;
}

/** Whether `value` is a date Sure's `Date.parse` and Archant both read, as YYYY-MM-DD. */
const isDate = (value: unknown): value is IsoDate => z.iso.date().safeParse(value).success;

const formattedOf = (amount: MinorUnits, currency: string) => formatMoney({ amount, currency });

/** A magnitude, as Sure's `Money#abs.format`. */
const magnitudeOf = (amount: MinorUnits, currency: string) =>
	formattedOf(toMinorUnits(Math.abs(amount)), currency);

/** Sure's `bill_id` check: an id that is not a UUID is refused before any read. */
function billIdOf(value: string): string {
	if (!UUID.test(value)) {
		refuseWithHint(
			"bill_id is not a valid id",
			"Pass the exact id returned by get_bills.",
			"VALIDATION_ERROR",
		);
	}

	return value;
}

/** A read whose `NOT_FOUND` answers as Sure's tool caller answers a missing record. */
async function reachable<Read>(read: () => Promise<Read>): Promise<Read> {
	try {
		return await read();
	} catch (error) {
		if (error instanceof AppError && error.code === "NOT_FOUND") {
			refuseNoSuchRecord();
		}

		throw error;
	}
}

const snakeCase = (path: string) => path.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`);

/**
 * A service's refusal of a write as Sure's `errors.full_messages`: Sure's
 * sentence where it has one, else each field and code, as the other tools
 * name them.
 */
function writeRefusal(error: AppError, hint: string): never {
	const fields = (error.fields ?? []).map(({ path, code }) => `${snakeCase(path)} ${code}`);

	refuseWithHint(
		error.code === "RECURRING_ALREADY_EXISTS"
			? "This bill already exists"
			: fields.length === 0
				? error.message
				: fields.join("; "),
		hint,
		error.code,
	);
}

/** A write whose service refusal answers as Sure's model refusal. */
async function written<Written>(write: () => Promise<Written>, hint: string): Promise<Written> {
	try {
		return await write();
	} catch (error) {
		if (error instanceof AppError) {
			if (error.code === "NOT_FOUND") {
				refuseNoSuchRecord();
			}

			writeRefusal(error, hint);
		}

		throw error;
	}
}

const OCCURRENCE_STATES = [
	"upcoming",
	"due",
	"overdue",
	...OCCURRENCE_STATUSES.filter((status) => status !== "scheduled"),
	"paused",
	"ended",
	"suggested",
] as const;

/** Sure's `serialize_series`, its `nil` keys left out. */
const billOutput = z.object({
	id: z.string(),
	name: z.string().describe("The owner's name for it, else the merchant's, else the bank label."),
	bill_type: z
		.enum(BILL_TYPES)
		.describe(
			'The direction comes from it: "income" is money coming in, any other money going out; "transfer" moves it into another of the owner\'s accounts.',
		),
	status: billStatusSchema.describe(
		'"suggested": found by Archant, awaiting the owner, not a bill yet; "paused": set aside.',
	),
	amount: formatted("Each occurrence's amount, a positive magnitude"),
	currency: z.string(),
	frequency: z
		.enum([...FREQUENCY_PRESETS, CUSTOM_PRESET])
		.describe('"custom": a cadence no preset names, such as every 5 weeks.'),
	next_due_date: z
		.string()
		.describe("YYYY-MM-DD: the current open occurrence's, else the next expected one."),
	autopay: z.boolean(),
	detected_automatically: z.boolean().describe("false when the owner declared it."),
	category: z.string().optional().describe("Its category's name; absent without one."),
	account: namedRef.optional().describe("Absent for a bill paid from any account."),
	destination_account: namedRef
		.optional()
		.describe("The account a recurring transfer pays into; absent for any other bill."),
	monthly_equivalent: formatted("Its cost a month, whatever its cadence"),
	payment_url: z.string().optional(),
});

/** Sure's `serialize_occurrence`. */
const occurrenceOutput = z.object({
	due_on: z.string(),
	effective_due_on: z.string().describe("The due date, or a later one the owner postponed it to."),
	state: z
		.enum(OCCURRENCE_STATES)
		.describe(
			"upcoming, due (from three days before), overdue (three days after), or once closed paid, skipped or missed. Nobody is paying a paused or ended bill, so its unpaid occurrence is never overdue, due or upcoming: its state reads the bill's status instead: paused, ended or suggested.",
		),
	expected: formatted("What it expects"),
	paid: formatted("What its confirmed payments sum to"),
	remaining: formatted("What is left to pay"),
	partially_paid: z.boolean(),
});

/** The names of the bills' categories, read once for all of them. */
async function categoryNames(
	deps: ServiceDeps,
	bills: readonly Pick<RecurringRecord, "categoryId">[],
): Promise<ReadonlyMap<string, string>> {
	return (
		await namesOf(deps, {
			categories: bills.flatMap((bill) => (bill.categoryId === null ? [] : [bill.categoryId])),
		})
	).categories;
}

/**
 * Sure's `serialize_series`, from what a write returns as well as from a
 * read: its name, next due date and monthly equivalent computed as « Toutes
 * les factures » computes them.
 */
function billOf(
	bill: RecurringRecord,
	categories: ReadonlyMap<string, string>,
): z.input<typeof billOutput> {
	const category = bill.categoryId === null ? undefined : categories.get(bill.categoryId);

	return {
		id: bill.id,
		name: displayName(bill),
		bill_type: bill.billType,
		status: lifecycleOf(bill.status),
		amount: magnitudeOf(bill.amount, bill.currency),
		currency: bill.currency,
		frequency: bill.frequency.key === "interval" ? CUSTOM_PRESET : bill.frequency.key,
		next_due_date: nextDueDateOf(bill),
		autopay: bill.autopay,
		detected_automatically: !bill.manual,
		...(category === undefined ? {} : { category }),
		...(bill.accountId === null
			? {}
			: { account: { id: bill.accountId, name: bill.accountName ?? "" } }),
		...(bill.destinationAccountId === null
			? {}
			: {
					destination_account: {
						id: bill.destinationAccountId,
						name: bill.destinationAccountName ?? "",
					},
				}),
		monthly_equivalent: magnitudeOf(monthlyEquivalent(bill.rules, bill.amount), bill.currency),
		...(bill.paymentUrl === null ? {} : { payment_url: bill.paymentUrl }),
	};
}

function occurrenceOf(
	occurrence: OccurrenceView & { open: boolean },
): z.input<typeof occurrenceOutput> {
	const { currency } = occurrence;

	return {
		due_on: occurrence.dueOn,
		effective_due_on: occurrence.effectiveDueOn,
		state: occurrence.state,
		expected: magnitudeOf(occurrence.expected, currency),
		paid: magnitudeOf(occurrence.paid, currency),
		remaining: magnitudeOf(occurrence.remaining, currency),
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

/** Sure's `percent_change`: signed, to one decimal; `null` without a previous amount. */
const percentChangeOf = (change: PriceChange) =>
	change.previousAmount === 0 ? null : change.percent / 10;

/** Sure's `unknown_value`: a filter value Sure's function does not know. */
function knownValue<Value extends string>(
	value: string | null | undefined,
	allowed: readonly Value[],
	field: string,
): Value | undefined {
	if (isBlank(value)) {
		return undefined;
	}

	const known = allowed.find((one) => one === value);

	if (known === undefined) {
		refuseWithHint(
			`${value} is not a valid ${field}`,
			`Valid values: ${allowed.join(", ")}.`,
			"VALIDATION_ERROR",
		);
	}

	return known;
}

/** Sure's range check: a present value must be a whole number within the bounds. */
function wholeNumberWithin(
	value: unknown,
	[min, max]: readonly [number, number],
	refusal: { error: string; hint: string },
): number | undefined {
	if (isBlank(value)) {
		return undefined;
	}

	const number = wholeNumberOf(value);

	if (number === null || number < min || number > max) {
		refuseWithHint(refusal.error, refusal.hint, "VALIDATION_ERROR");
	}

	return number;
}

export const getBills = defineTool({
	name: "get_bills",
	title: "Bills",
	description: `Get the owner's bills, subscriptions and other recurring obligations, as « Factures » lists them, by next due date, each with its current occurrence's payment state. status is the lifecycle: "active" by default, "suggested" (found by Archant, awaiting the owner's confirmation, not a bill yet), "paused", "ended", "all". payment_state filters on the current occurrence: "overdue", "due", "upcoming", "partial", "paid"; nobody is paying a paused or ended bill, so its unpaid occurrence is never overdue or due. bill_type "income" is a declared income, not an obligation. Amounts are positive magnitudes, formatted; bill_type carries the direction. The totals cover every match, not only the bills shown, leave out the incomes and the transfers (a transfer moves money, it is not spend), and give each bill a monthly equivalent, summed per currency. An empty answer carries a hint when other statuses hold bills. Use get_bill_details for one bill's history. ${BANK_TEXT}`,
	scope: "archant:read",
	annotations: READ_ONLY,
	input: getBillsInput,
	output: z.object({
		as_of_date: z.string().describe("Today, YYYY-MM-DD."),
		total_results: z.number().int().describe("Every matching bill."),
		truncated: z.boolean().describe(`true when more than ${MAX_BILLS} match.`),
		family_currency: z.string().describe("The household's reporting currency."),
		bills: z.array(
			billOutput.extend({
				current_occurrence: occurrenceOutput
					.nullable()
					.describe("The earliest open occurrence, else the latest; null before the first."),
			}),
		),
		totals: z.object({
			active_count: z.number().int(),
			overdue_count: z
				.number()
				.int()
				.describe("Matching bills whose current occurrence is overdue."),
			active_monthly_equivalent_by_currency: z
				.record(z.string(), z.string())
				.describe(
					"What the active bills but the incomes and the transfers cost a month, in each currency, formatted.",
				),
		}),
		hint: z
			.string()
			.optional()
			.describe("When nothing matched a status: how many bills other statuses hold."),
	}),
	run: async (deps, input) => {
		const status = knownValue(input.status, BILL_LIFECYCLES, "status") ?? "active";
		const billType = knownValue(input.bill_type, BILL_TYPES, "bill_type");
		const paymentState = knownValue(input.payment_state, BILL_PAYMENT_STATES, "payment_state");
		const dueWithinDays = wholeNumberWithin(input.due_within_days, [1, 365], {
			error: "due_within_days must be a whole number between 1 and 365",
			hint: "Retry once with a value in that range, or omit it.",
		});
		const found = await findBills(deps, {
			status,
			billType,
			paymentState,
			search: isBlank(input.search) ? undefined : input.search!,
			dueWithinDays,
		});
		const shown = found.bills.slice(0, MAX_BILLS);
		const names = await categoryNames(deps, shown);
		const elsewhere = found.elsewhere.map((group) => `${group.count} ${group.status}`).join(", ");

		return {
			result: {
				as_of_date: today(deps.timeZone),
				total_results: found.bills.length,
				truncated: found.bills.length > MAX_BILLS,
				family_currency: found.familyCurrency,
				bills: shown.map((bill) => ({
					...billOf(bill, names),
					current_occurrence: currentOf(bill),
				})),
				totals: {
					active_count: found.totals.activeCount,
					overdue_count: found.totals.overdueCount,
					active_monthly_equivalent_by_currency: Object.fromEntries(
						found.totals.activeMonthlyByCurrency.map(([currency, monthly]) => [
							currency,
							formattedOf(monthly, currency),
						]),
					),
				},
				...(elsewhere === ""
					? {}
					: {
							hint: `Nothing matched status ${status}, but this family has ${elsewhere}. Call get_bills again with that status, or status: all, before telling the user they have none.`,
						}),
			},
			changedRows: 0,
		};
	},
});

const paymentOutput = z.object({
	amount: formatted("What it pays"),
	paid_on: z.string().optional(),
	source: z
		.enum(ALLOCATION_SOURCES)
		.describe(
			'"auto_matched": found by Archant; "user_confirmed": accepted by the owner; "user_created": recorded by hand, with no transaction.',
		),
	state: z.enum(ALLOCATION_STATES).describe('"suggested" awaits the owner and does not count.'),
	transaction_name: z.string().optional().describe("The label of the transaction that paid it."),
});

const priceChangeFields = {
	effective_on: z.string(),
	previous_amount: formatted("The amount before"),
	new_amount: formatted("The amount after"),
};

/** Sure's `configuration`, its `nil` keys left out, as Sure's `.compact` leaves a default bill's. */
function configurationOf(bill: BillHistory["bill"]) {
	const { currency } = bill;
	// Sure's bounds in its own sign: an expense's lowest is Archant's highest.
	const bounds = {
		expected_amount_min: bill.expectedAmountMax,
		expected_amount_max: bill.expectedAmountMin,
		expected_amount_avg: bill.expectedAmountAvg,
	};

	return {
		amount_strategy: "fixed" as const,
		weekend_adjust: "none" as const,
		end_mode: bill.endAfterCount === null ? ("never" as const) : ("after_count" as const),
		...(bill.endAfterCount === null ? {} : { end_after_count: bill.endAfterCount }),
		...(bill.anchorDate === null ? {} : { anchor_date: bill.anchorDate }),
		...(bill.notes === null ? {} : { notes: bill.notes }),
		schedule_pinned: bill.schedulePinned,
		...Object.fromEntries(
			Object.entries(bounds).flatMap(([key, amount]) =>
				amount === null ? [] : [[key, magnitudeOf(amount, currency)]],
			),
		),
	};
}

export const getBillDetails = defineTool({
	name: "get_bill_details",
	title: "One bill",
	description: `Get one bill's complete story: its configuration, every open occurrence, the last ${HISTORY_LIMIT} settled occurrences with their payments, its next three due dates, its price changes and its cost analytics. Analytics come from confirmed payments on paid occurrences only, never from estimates, and are null before anything is paid; annualized_declared is the bill's own amount times its cadence, annualized_cost follows what was actually paid. history is capped at ${HISTORY_LIMIT} settled cycles and price_changes at ${PRICE_CHANGE_MONTHS} months; history_window and price_change_window give the real totals, so do not sum the rows and present the result as a lifetime figure. bill_id must be the exact id returned by get_bills. ${BANK_TEXT}`,
	scope: "archant:read",
	annotations: READ_ONLY,
	input: billIdInput,
	output: z.object({
		bill: billOutput.extend({
			amount_strategy: z.literal("fixed"),
			weekend_adjust: z.literal("none"),
			end_mode: z.enum(["never", "after_count"]),
			end_after_count: z.number().int().optional().describe("An installment's number of payments."),
			anchor_date: z.string().optional().describe("The date the schedule counts from."),
			notes: z.string().optional(),
			schedule_pinned: z
				.boolean()
				.describe("true once the owner set the cadence: detection never moves its day."),
			expected_amount_min: formatted("The lowest amount seen").optional(),
			expected_amount_max: formatted("The highest amount seen").optional(),
			expected_amount_avg: formatted("The mean amount seen").optional(),
		}),
		analytics: z
			.object({
				average_paid: formatted("The mean of what each paid occurrence was paid"),
				lowest_paid: formatted("The least a paid occurrence was paid"),
				highest_paid: formatted("The most a paid occurrence was paid"),
				annualized_cost: formatted("average_paid times the occurrences a year"),
				annualized_declared: formatted("The bill's own amount a year"),
				paid_this_year: formatted("Every confirmed payment since 1 January"),
			})
			.nullable(),
		open_occurrences: z.array(occurrenceOutput),
		history: z
			.array(
				occurrenceOutput.extend({
					status: z.enum(OCCURRENCE_STATUSES),
					payments: z.array(paymentOutput),
				}),
			)
			.describe(`The latest first, ${HISTORY_LIMIT} at most.`),
		history_window: z.object({
			count: z.number().int().describe("Every settled occurrence."),
			truncated: z.boolean(),
		}),
		upcoming_due_dates: z.array(z.string()).describe("The next three after today."),
		price_changes: z
			.array(
				z.object({
					...priceChangeFields,
					percent_change: z
						.number()
						.nullable()
						.describe("Signed, to one decimal: 18.5 is a rise of 18.5 %."),
					source: z.literal("detected"),
				}),
			)
			.describe("The latest first."),
		price_change_window: z.object({ months: z.number().int(), count: z.number().int() }),
	}),
	run: async (deps, input) => {
		const history = await reachable(() => billHistory(deps, billIdOf(input.bill_id)));
		const { bill, analytics } = history;
		const names = await categoryNames(deps, [bill]);
		const money = (amount: MinorUnits) => magnitudeOf(amount, bill.currency);

		return {
			result: {
				bill: { ...billOf(bill, names), ...configurationOf(bill) },
				analytics:
					analytics === null
						? null
						: {
								average_paid: money(analytics.averagePaid),
								lowest_paid: money(analytics.lowestPaid),
								highest_paid: money(analytics.highestPaid),
								annualized_cost: money(analytics.annualizedCost),
								annualized_declared: money(analytics.annualizedDeclared),
								paid_this_year: money(analytics.paidThisYear),
							},
				open_occurrences: history.open.map((row) => occurrenceOf({ ...row, open: true })),
				history: history.closed.map((row) => ({
					...occurrenceOf({ ...row, open: false }),
					status: row.status,
					payments: row.payments.map((payment) => ({
						amount: magnitudeOf(payment.amount, row.currency),
						...(payment.paidOn === null ? {} : { paid_on: payment.paidOn }),
						source: payment.source,
						state: payment.state,
						...(payment.transactionLabel === null
							? {}
							: { transaction_name: payment.transactionLabel }),
					})),
				})),
				history_window: {
					count: history.closedCount,
					truncated: history.closedCount > history.closed.length,
				},
				upcoming_due_dates: history.nextDueDates,
				price_changes: history.priceChanges.map((change) => ({
					effective_on: change.effectiveOn,
					previous_amount: magnitudeOf(change.previousAmount, change.currency),
					new_amount: magnitudeOf(change.newAmount, change.currency),
					percent_change: percentChangeOf(change),
					source: "detected" as const,
				})),
				price_change_window: {
					months: PRICE_CHANGE_MONTHS,
					count: history.priceChanges.length,
				},
			},
			changedRows: 0,
		};
	},
});

/** One audit section as Sure's `section`. */
const sectionOf = <Item extends z.ZodType>(item: Item, what: string) =>
	z
		.object({
			items: z.array(item).describe("The first twenty."),
			truncated: z.boolean(),
			count: z.number().int().describe("Every one found."),
		})
		.describe(what);

/** An audit section with each of its items as the tool writes it, in Sure's key order. */
const mapSection = <In, Out>(
	found: { items: In[]; count: number; truncated: boolean },
	item: (value: In) => Out,
) => ({ items: found.items.map(item), truncated: found.truncated, count: found.count });

const EMPTY_SECTION = { items: [], truncated: false, count: 0 };

const billRef = { bill_id: z.string(), name: z.string() };

export const getBillAudit = defineTool({
	name: "get_bill_audit",
	title: "Bills review",
	description: `Audit the owner's bills and subscriptions and return the facts a review needs: possible duplicate bills, recent price changes, trials about to convert and upcoming renewals (always empty: Archant keeps no trial or renewal date yet), bills overdue by at least one whole billing cycle, paused bills still carrying unpaid occurrences, detections awaiting the owner's confirmation, and recurring charge patterns no bill follows yet. Every section is computed from the household's data; narrate and prioritise the findings rather than recompute them. Duplicate detection is strict (same name, amount and due day), so two subscription tiers to one merchant are never flagged. Propose specific fixes and ask before changing anything. ${BANK_TEXT}`,
	scope: "archant:read",
	annotations: READ_ONLY,
	input: billAuditInput,
	output: z.object({
		as_of_date: z.string().describe("Today, YYYY-MM-DD."),
		possible_duplicates: sectionOf(
			z.object({
				name: z.string(),
				amount: formatted("Their amount"),
				bills: z.array(
					z.object({
						id: z.string(),
						account: z.string().nullable().describe("null for a bill paid from any account."),
					}),
				),
			}),
			"Groups of active bills sharing a name, an amount and a due day.",
		),
		price_changes: sectionOf(
			z.object({
				bill: z.string(),
				bill_id: z.string(),
				...priceChangeFields,
				percent_change: z.number().optional().describe("Signed, to one decimal."),
			}),
			"Of any bill since lookback_months, the latest first.",
		),
		upcoming_trials: sectionOf(z.never(), "Always empty: Archant keeps no trial end yet."),
		upcoming_renewals: sectionOf(z.never(), "Always empty: Archant keeps no renewal date yet."),
		long_overdue: sectionOf(
			z.object({
				...billRef,
				cycles_overdue: z
					.number()
					.int()
					.describe("Whole cycles of its own cadence since its due date."),
				next_due_date: z.string(),
				amount: formatted("Its amount"),
			}),
			"Active bills but incomes a whole cycle or more past due, the most cycles first.",
		),
		dormant: sectionOf(
			z.object({ ...billRef, status: z.literal("paused") }),
			"Paused bills still holding an open occurrence.",
		),
		awaiting_confirmation: sectionOf(
			z.object({ ...billRef, amount: formatted("Its amount") }),
			"Suggestions: patterns Archant found, not bills until the owner adds them.",
		),
		undeclared_candidates: sectionOf(
			z.object({
				name: z.string(),
				average_amount: formatted("The mean of its charges"),
				occurrence_count: z.number().int(),
				last_seen: z.string(),
			}),
			"Recurring charges no bill follows, as « Ajouter une facture » offers them, the latest first.",
		),
	}),
	run: async (deps, input) => {
		const lookbackMonths =
			wholeNumberWithin(input.lookback_months, [1, 24], {
				error: "lookback_months must be a whole number between 1 and 24",
				hint: "Retry once with a value in that range, or omit it for 12.",
			}) ?? 12;
		const audit = await billAudit(deps, lookbackMonths);

		return {
			result: {
				as_of_date: today(deps.timeZone),
				possible_duplicates: mapSection(audit.possibleDuplicates, (group) => ({
					name: group.name,
					amount: magnitudeOf(group.amount, group.currency),
					bills: group.bills.map((bill) => ({ id: bill.id, account: bill.accountName })),
				})),
				price_changes: mapSection(audit.priceChanges, (change) => {
					const percent = percentChangeOf(change);

					return {
						bill: change.name,
						bill_id: change.seriesId,
						effective_on: change.effectiveOn,
						previous_amount: magnitudeOf(change.previousAmount, change.currency),
						new_amount: magnitudeOf(change.newAmount, change.currency),
						...(percent === null ? {} : { percent_change: percent }),
					};
				}),
				upcoming_trials: EMPTY_SECTION,
				upcoming_renewals: EMPTY_SECTION,
				long_overdue: mapSection(audit.longOverdue, ({ bill, cyclesOverdue }) => ({
					bill_id: bill.id,
					name: bill.displayName,
					cycles_overdue: cyclesOverdue,
					next_due_date: bill.nextDueDate,
					amount: magnitudeOf(bill.amount, bill.currency),
				})),
				dormant: mapSection(audit.dormant, (bill) => ({
					bill_id: bill.id,
					name: bill.displayName,
					status: "paused" as const,
				})),
				awaiting_confirmation: mapSection(audit.awaitingConfirmation, (bill) => ({
					bill_id: bill.id,
					name: bill.displayName,
					amount: magnitudeOf(bill.amount, bill.currency),
				})),
				undeclared_candidates: mapSection(audit.undeclaredCandidates, (candidate) => ({
					name: candidate.name,
					average_amount: magnitudeOf(candidate.amount, candidate.currency),
					occurrence_count: candidate.occurrenceCount,
					last_seen: candidate.lastOccurrenceDate,
				})),
			},
			changedRows: 0,
		};
	},
});

const TRUE_INPUTS = new Set<unknown>([true, "true", "t", "1", 1]);
const FALSE_INPUTS = new Set<unknown>([false, "false", "f", "0", 0]);

/** Sure's `resolve_boolean`: its allowlist, anything else refused; absent is false. */
function flagOf(value: unknown, key: string): boolean {
	if (value === undefined || value === null) {
		return false;
	}

	const normalised = typeof value === "string" ? value.trim().toLowerCase() : value;

	if (TRUE_INPUTS.has(normalised)) {
		return true;
	}

	if (FALSE_INPUTS.has(normalised)) {
		return false;
	}

	return refuseWithHint(
		`${key} must be true or false`,
		`Pass a JSON boolean, not ${inspect(value)}.`,
		"VALIDATION_ERROR",
	);
}

/** The account `name` names, as Sure's bill tools resolve it: exactly one, else refused. */
async function accountNamed(deps: ServiceDeps, name: string | null): Promise<string> {
	const ids = name === null ? [] : await accountsNamed(deps, name);

	if (ids.length === 0) {
		refuseWithHint(
			`No account named ${inspect(name)} that you can add bills to`,
			"Call get_accounts and retry once with the exact name of a writable account.",
			"NOT_FOUND",
		);
	}

	if (ids.length > 1) {
		refuseWithHint(
			`More than one account is named ${inspect(name)}`,
			"Ask the user which one they mean; this tool cannot pick between namesakes.",
			"VALIDATION_ERROR",
		);
	}

	return ids[0]!;
}

/** The category this exact name names, else Sure's refusal. */
async function categoryNamed(deps: ServiceDeps, name: string | null): Promise<string | undefined> {
	const [id] = name === null ? [] : ((await idsNamed(deps, "categories", [name])) ?? []);

	return id;
}

function refuseNoCategory(name: string | null): never {
	refuseWithHint(
		`No category named ${inspect(name)}`,
		"Call get_categories and retry once with the exact category name.",
		"NOT_FOUND",
	);
}

/** Sure's frequency check: a preset, or the refusal that names it. */
function presetOf(
	value: string | null | undefined,
	hint: string,
): (typeof FREQUENCY_PRESETS)[number] {
	const preset = FREQUENCY_PRESETS.find((one) => one === value);

	if (preset === undefined) {
		refuseWithHint(
			`${value ?? ""} is not a frequency this app recognizes`,
			hint,
			"VALIDATION_ERROR",
		);
	}

	return preset;
}

const PRESETS_HINT = `Use one of: ${FREQUENCY_PRESETS.join(", ")}.`;

export const createBillTool = defineTool({
	name: "create_bill",
	title: "Create a bill",
	description:
		"Create a bill, subscription, installment plan or income schedule for the owner, as « Ajouter une facture » does: active at once, due on first_due_on and then on its cadence. amount is always a positive magnitude; set is_income true for income and Archant derives the sign. account_name must exactly match a name returned by get_accounts; omit it to create the bill paid from any account, in the reporting currency. category_name must exactly match a name returned by get_categories. Transfers between accounts cannot be created here. It answers the bill and its next three due dates. Confirm the details with the owner before calling this.",
	scope: "archant:write",
	annotations: CREATES,
	input: createBillInput,
	output: z.object({
		created: z.literal(true),
		bill: billOutput,
		upcoming_due_dates: z.array(z.string()).describe("The next three from today."),
	}),
	run: async (deps, input) => {
		const isIncome = flagOf(input.is_income, "is_income");
		const autopay = flagOf(input.autopay, "autopay");
		const accountId = isBlank(input.account_name)
			? null
			: await accountNamed(deps, input.account_name!);
		const categoryId = isBlank(input.category_name)
			? undefined
			: ((await categoryNamed(deps, input.category_name!)) ??
				refuseNoCategory(input.category_name!));
		const frequency = isBlank(input.frequency)
			? "monthly"
			: presetOf(input.frequency, `${PRESETS_HINT} Omit it entirely for monthly.`);
		const amount = sureDecimalText(isBlank(input.amount) ? "0" : input.amount);

		if (amount === null || /^-?[0.]+$/u.test(amount)) {
			refuseWithHint("Enter the amount as a plain number", FIX_HINT, "VALIDATION_ERROR");
		}

		if (!isDate(input.first_due_on)) {
			refuseWithHint("Enter the bill's next due date", FIX_HINT, "VALIDATION_ERROR");
		}

		const created = await written(
			() =>
				declareBill(deps, {
					name: input.name,
					amount: amount.replace(/^-/u, ""),
					firstDueOn: input.first_due_on,
					accountId,
					kind: isIncome ? "income" : "bill",
					frequency: { preset: frequency },
					billType: SURE_BILL_TYPES.find((type) => type === input.bill_type),
					categoryId,
					autopay,
					paymentUrl: input.payment_url ?? undefined,
					notes: input.notes ?? undefined,
				}),
			FIX_HINT,
		);

		return {
			result: {
				created: true as const,
				bill: billOf(created, await categoryNames(deps, [created])),
				upcoming_due_dates: nextDueDates(created, today(deps.timeZone)),
			},
			changedRows: 1,
		};
	},
});

const DAY_FIELDS = ["due_day_of_month", "weekday", "month_of_year"] as const;

/** A day field as the edit dialog sends it to `editBill`: its text. */
const dayText = (value: string | number | null | undefined) =>
	value === undefined || value === null ? undefined : String(value);

// The bounds `editBill` holds each day to; a day outside them goes to the
// service, which refuses it by name.
const DAY_BOUNDS = {
	due_day_of_month: [-1, 31],
	weekday: [0, 6],
	month_of_year: [1, 12],
} as const;

/**
 * Whether Sure's `FrequencyPreset.apply` would change the schedule: a day
 * that is not a whole number within its bounds counts as a change, which the
 * service then refuses.
 */
function changesSchedule(
	bill: BillView,
	preset: (typeof FREQUENCY_PRESETS)[number],
	days: Partial<Record<(typeof DAY_FIELDS)[number], unknown>>,
): boolean {
	const read = DAY_FIELDS.map((field) => {
		const value = days[field];

		if (value === undefined || value === null) {
			return null;
		}

		const number = wholeNumberOf(value);
		const [min, max] = DAY_BOUNDS[field];

		// Only a day of the month has no 0: weekday 0 is Sunday.
		return number === null ||
			number < min ||
			number > max ||
			(field === "due_day_of_month" && number === 0)
			? undefined
			: number;
	});

	if (read.includes(undefined)) {
		return true;
	}

	const [dayOfMonth, weekday, monthOfYear] = read;

	return applyFrequency(bill, { preset, dayOfMonth, weekday, monthOfYear }) !== null;
}

export const updateBillTool = defineTool({
	name: "update_bill",
	title: "Update a bill",
	description:
		'Update one bill\'s configuration, as its edit dialog does, in one write: a refusal anywhere changes nothing. Only pass the fields being changed. amount is a positive magnitude; the bill keeps its own direction, and the change applies from today forward: occurrences already due keep the old figure. account_name and category_name must exactly match names from get_accounts and get_categories; pass category_name "Uncategorized" to clear the category. Changing the schedule (frequency, due day) pins it: detection respects it from then on. status "paused" sets the bill aside, with no new occurrences; "active" resumes it. bill_type moves between bill, subscription and installment only. renews_on and trial_ends_on are refused: Archant keeps no such date yet. It answers the fields it changed and the bill. Confirm the change with the owner before calling this.',
	scope: "archant:write",
	annotations: SETS,
	input: updateBillInput,
	output: z.object({
		updated: z.literal(true),
		changed_fields: z
			.array(z.string())
			.describe(
				"Sure's attribute names, in order: name, autopay, payment_url, notes, bill_type, amount, account, category, status, schedule.",
			),
		bill: billOutput,
	}),
	run: async (deps, input) => {
		const billId = billIdOf(input.bill_id);
		const current = await reachable(() => billView(deps, billId));
		const changed: string[] = [];
		const edit: Parameters<typeof updateBill>[2] = {};

		// Sure's `apply_simple_fields`.
		if (input.name !== undefined) {
			edit.name = input.name;
			changed.push("name");
		}

		if (input.autopay !== undefined) {
			edit.autopay = input.autopay !== null && !RAILS_FALSE.has(input.autopay);
			changed.push("autopay");
		}

		if (input.payment_url !== undefined) {
			edit.paymentUrl = input.payment_url;
			changed.push("payment_url");
		}

		if (input.notes !== undefined) {
			edit.notes = input.notes;
			changed.push("notes");
		}

		for (const key of ["renews_on", "trial_ends_on"] as const) {
			if (input[key] !== undefined) {
				refuseWithHint(
					`${key} is not kept by Archant yet`,
					"Do not retry. Tell the user renewal and trial dates are not tracked.",
					"VALIDATION_ERROR",
				);
			}
		}

		// Sure's `apply_bill_type`.
		if (input.bill_type !== undefined) {
			if (!(SURE_BILL_TYPES as readonly string[]).includes(current.billType)) {
				refuseWithHint(
					`${current.displayName} is ${current.billType} and cannot change kind here`,
					"Only bill, subscription and installment kinds are editable.",
					"VALIDATION_ERROR",
				);
			}

			const billType = SURE_BILL_TYPES.find((type) => type === input.bill_type);

			if (billType === undefined) {
				refuseWithHint(
					`${inspect(input.bill_type)} is not a kind this tool can set`,
					`Use one of: ${SURE_BILL_TYPES.join(", ")}.`,
					"VALIDATION_ERROR",
				);
			}

			edit.billType = billType;
			changed.push("bill_type");
		}

		// Sure's `apply_amount`: a magnitude, the bill keeping its sign.
		if (input.amount !== undefined) {
			const amount = input.amount === null ? null : sureDecimalText(input.amount);

			if (amount === null) {
				refuseWithHint(
					"amount is not a number",
					"Pass a positive numeric magnitude.",
					"VALIDATION_ERROR",
				);
			}

			if (/^-?[0.]+$/u.test(amount)) {
				refuseWithHint(
					"amount must be greater than zero",
					"Pass a positive magnitude.",
					"VALIDATION_ERROR",
				);
			}

			edit.amount = amount.replace(/^-/u, "");
			changed.push("amount");
		}

		// Sure's `apply_account`.
		if (input.account_name !== undefined) {
			edit.accountId = await accountNamed(deps, input.account_name);
			changed.push("account");
		}

		// Sure's `apply_category`: a real category first, then its words for none.
		if (input.category_name !== undefined) {
			const name = input.category_name;
			const id = await categoryNamed(deps, name);

			if (id === undefined && (name === null || !isUncategorisedName(name))) {
				refuseNoCategory(name);
			}

			edit.categoryId = id ?? null;
			changed.push("category");
		}

		// Sure's `apply_status`: « En pause » is stored `inactive`.
		let status: "active" | "inactive" | undefined;

		if (input.status !== undefined) {
			if (input.status !== "active" && input.status !== "paused") {
				refuseWithHint(
					`${inspect(input.status)} is not a status this tool can set`,
					"Use active or paused.",
					"VALIDATION_ERROR",
				);
			}

			status = input.status === "paused" ? "inactive" : "active";
			changed.push("status");
		}

		// Sure's `apply_schedule`.
		const days = DAY_FIELDS.filter((field) => input[field] !== undefined);

		if (input.frequency === undefined) {
			if (days.length > 0) {
				refuseWithHint(
					`${toSentence(days)} need frequency alongside them`,
					"Pass frequency too (get_bill_details shows the current one).",
					"VALIDATION_ERROR",
				);
			}
		} else {
			const preset = presetOf(input.frequency, PRESETS_HINT);

			if (changesSchedule(current, preset, input)) {
				edit.frequency = {
					preset,
					dayOfMonth: dayText(input.due_day_of_month),
					weekday: dayText(input.weekday),
					monthOfYear: dayText(input.month_of_year),
				};
				changed.push("schedule");
			}
		}

		if (changed.length === 0) {
			refuseWithHint(
				"No recognized fields to change",
				"Pass at least one editable field.",
				"VALIDATION_ERROR",
			);
		}

		const updated = await written(
			() => updateBill(deps, billId, { ...edit, ...(status === undefined ? {} : { status }) }),
			FIX_HINT,
		);

		return {
			result: {
				updated: true as const,
				changed_fields: changed,
				bill: billOf(updated, await categoryNames(deps, [updated])),
			},
			changedRows: 1,
		};
	},
});

/** What `record_bill_payment` was asked, once its formats are read. */
type PaymentAsk = { dueOn: IsoDate | undefined; settling: boolean; amount: string | undefined };

/**
 * Sure's `resolve_occurrence` over the bill as it stands: the refusal it
 * answers, `undefined` when it finds the occurrence. Sure's `derived_state`,
 * not the paused one the tools show, says whether the current one is owed.
 */
function occurrenceRefusal(
	history: BillHistory,
	ask: PaymentAsk,
	day: IsoDate,
): { error: string; hint: string; outcome: ErrorCode } | undefined {
	const name = history.bill.displayName;
	const { open } = history;

	if (ask.dueOn !== undefined) {
		if (open.some((occurrence) => occurrence.dueOn === ask.dueOn)) {
			return undefined;
		}

		const dates = open.slice(0, 6).map((occurrence) => occurrence.dueOn);

		return {
			error: `No open occurrence of ${name} is due on ${ask.dueOn}`,
			hint: `Open due dates: ${dates.length === 0 ? "none" : dates.join(", ")}. Retry once with one of them, or omit occurrence_due_on.`,
			outcome: "NOT_FOUND",
		};
	}

	const [current] = open;

	if (current === undefined) {
		return {
			error: `${name} has no open occurrence to pay`,
			hint: "Nothing is currently owed on this bill. Use get_bill_details to see its state.",
			outcome: "NOT_FOUND",
		};
	}

	const state = derivedState(
		{ status: "scheduled", dueOn: current.dueOn, snoozedUntil: current.effectiveDueOn },
		day,
	);

	return ask.settling && state === "upcoming"
		? {
				error: `${name} has nothing owed right now`,
				hint: `Its next cycle is due ${current.dueOn} and is not owed yet. If you really mean to pay ahead, retry with occurrence_due_on set to that date.`,
				outcome: "VALIDATION_ERROR",
			}
		: undefined;
}

/**
 * A refusal worded from the bill, as Sure's: the occurrence's own refusal
 * first, as Sure resolves the occurrence before anything else, else
 * `fallback`. Read only once something was refused.
 */
async function refusePayment(
	deps: ServiceDeps,
	billId: string,
	ask: PaymentAsk,
	fallback: (history: BillHistory) => { error: string; hint: string; outcome: ErrorCode },
): Promise<never> {
	const history = await reachable(() => billHistory(deps, billId));
	const refusal = occurrenceRefusal(history, ask, today(deps.timeZone)) ?? fallback(history);

	refuseWithHint(refusal.error, refusal.hint, refusal.outcome);
}

/** Sure's `check_capacity` refusal, from the occurrence the payment went to. */
function overRemaining(history: BillHistory, ask: PaymentAsk) {
	const target =
		history.open.find((occurrence) => occurrence.dueOn === ask.dueOn) ?? history.open[0]!;
	const amount = parseAmount(ask.amount ?? "", target.currency);

	if (amount === null) {
		return {
			error: "amount is not a number",
			hint: AMOUNT_HINT,
			outcome: "VALIDATION_ERROR" as const,
		};
	}

	return {
		error: `${formattedOf(amount, target.currency)} is more than the ${formattedOf(target.remaining, target.currency)} still owed on the cycle due ${target.dueOn}`,
		hint: "Record at most the remaining amount. If this payment was already recorded, do not retry.",
		outcome: "VALIDATION_ERROR" as const,
	};
}

export const recordBillPaymentTool = defineTool({
	name: "record_bill_payment",
	title: "Record a bill payment",
	description:
		"Record a payment against a bill's open occurrence, or settle it in full. Omit amount to settle the occurrence completely, the remainder recorded as a payment by hand with no transaction; a settle without occurrence_due_on refuses an occurrence not owed yet, so a retry never pays next month. Pass amount for a partial payment, at most what remains; the occurrence stays open until payments cover the expected amount. occurrence_due_on picks an open occurrence by its due date; omitted, the current (earliest open) one is used. Linking a payment to a bank transaction is not possible here: Archant's matching and the review queue on « Factures » do it. Confirm with the owner before recording anything; if it was recorded already, do not retry.",
	scope: "archant:write",
	annotations: CREATES,
	input: recordBillPaymentInput,
	output: z.object({
		recorded: z.literal(true),
		bill: z.string().describe("The bill's name."),
		occurrence: occurrenceOutput.extend({ status: z.enum(OCCURRENCE_STATUSES) }),
	}),
	run: async (deps, input) => {
		const billId = billIdOf(input.bill_id);
		const settling = input.amount === undefined || input.amount === null;
		const dueOn = isBlank(input.occurrence_due_on) ? undefined : input.occurrence_due_on!;

		if (dueOn !== undefined && !isDate(dueOn)) {
			// Sure finds the bill before it reads the date.
			await reachable(() => billHistory(deps, billId));
			refuseWithHint("occurrence_due_on is not a valid date", DATE_HINT, "VALIDATION_ERROR");
		}

		const amount = settling ? undefined : sureDecimalText(input.amount!);
		const ask: PaymentAsk = { dueOn, settling, amount: amount ?? undefined };
		const refuse = (error: string, hint: string): Promise<never> =>
			refusePayment(deps, billId, ask, () => ({ error, hint, outcome: "VALIDATION_ERROR" }));

		if (!isBlank(input.paid_on) && !isDate(input.paid_on)) {
			await refuse("paid_on is not a valid date", DATE_HINT);
		}

		if (amount === null) {
			await refuse("amount is not a number", AMOUNT_HINT);
		}

		if (amount !== undefined && (amount!.startsWith("-") || /^[0.]+$/u.test(amount!))) {
			await refuse("amount must be greater than zero", AMOUNT_HINT);
		}

		try {
			const occurrence = await recordBillPayment(deps, billId, {
				occurrenceDueOn: dueOn,
				amount: ask.amount,
				paidOn: isBlank(input.paid_on) ? undefined : input.paid_on!,
			});

			return {
				result: {
					recorded: true as const,
					bill: occurrence.billName,
					occurrence: {
						...occurrenceOf({ ...occurrence, open: occurrence.status === "scheduled" }),
						status: occurrence.status,
					},
				},
				changedRows: 1,
			};
		} catch (error) {
			if (!(error instanceof AppError)) {
				throw error;
			}

			const exceeds = error.fields?.some((field) => field.code === "exceeds_remaining") ?? false;

			return refusePayment(deps, billId, ask, (history) =>
				exceeds
					? overRemaining(history, ask)
					: {
							error:
								(error.fields ?? [])
									.map(({ path, code }) => `${snakeCase(path)} ${code}`)
									.join("; ") || error.message,
							hint: AMOUNT_HINT,
							outcome: error.code,
						},
			);
		}
	},
});
