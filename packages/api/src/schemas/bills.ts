import type { IsoDate } from "../domain/dates.ts";
import type { FrequencyChoice } from "../domain/recurring/frequency.ts";

import { z } from "zod";

import type { CurrencyCode } from "@archant/data/money";
import {
	BILL_TYPES,
	LAST_DAY_OF_MONTH,
	MAX_END_AFTER_COUNT,
	RECURRENCE_FREQUENCIES,
} from "@archant/data/recurring";

import {
	CUSTOM_PRESET,
	FREQUENCY_PRESETS,
	INTERVAL_PRESET,
	isValidInterval,
} from "../domain/recurring/frequency.ts";
import { monthlyOn, nextOccurrenceFromToday } from "../domain/recurring/schedule.ts";
import { amountIn } from "./budgets.ts";
import { LABEL_MAX_LENGTH, NOTES_MAX_LENGTH } from "./transactions.ts";

// What the dialog reads beside the schemas: the picker's values, and the
// first due date a transaction prefills, from the domain the API checks with.
export {
	CUSTOM_PRESET,
	FREQUENCY_PRESETS,
	INTERVAL_PRESET,
	INTERVAL_UNITS,
	MAX_INTERVAL,
} from "../domain/recurring/frequency.ts";
export type { Frequency, FrequencyKey } from "../domain/recurring/frequency.ts";

/**
 * The first due date a bill declared from a transaction of `date` takes:
 * that day of the month from today on, as Sure's `prefill_recurring_from_entry`.
 */
export function firstDueFrom(date: IsoDate, today: IsoDate): IsoDate {
	const day = Number(date.slice(8, 10));

	// A plain monthly schedule always has a next date.
	return (
		nextOccurrenceFromToday(
			{ rules: [monthlyOn(day)], anchorDate: date, endAfterCount: null, expectedDayOfMonth: day },
			today,
		) ?? today
	);
}

/** « Ajouter une facture » or « Ajouter un revenu »: the sign of the amount follows. */
export const BILL_KINDS = ["bill", "income"] as const;

export type BillKind = (typeof BILL_KINDS)[number];

/** The types the owner picks from; `income` is the declare dialog's to set. */
export const EDITABLE_BILL_TYPES = ["bill", "subscription", "installment", "other"] as const;

/** `?kind=` of the declare dialog's starting points. */
export const candidatesQuerySchema = z.object({ kind: z.enum(BILL_KINDS) });

// What the route checks before it knows the account: every field the owner
// types is text, so the typed client knows the body's shape and a JavaScript
// number never rounds an amount. The service parses it with the account's
// currency by the schemas below.
const frequencyBody = z.object({
	preset: z.string(),
	interval: z.string().optional(),
	unit: z.string().optional(),
	dayOfMonth: z.string().optional(),
	secondDayOfMonth: z.string().optional(),
	weekday: z.string().optional(),
	monthOfYear: z.string().optional(),
});

export const declareBodySchema = z.object({
	kind: z.string(),
	name: z.string(),
	amount: z.string(),
	accountId: z.string(),
	firstDueOn: z.string(),
	frequency: frequencyBody,
	// The dialog sends neither: a bill is a `bill`, uncategorised, until edited.
	billType: z.string().optional(),
	categoryId: z.string().nullable().optional(),
	autopay: z.boolean().optional(),
	notes: z.string().nullable().optional(),
	paymentUrl: z.string().nullable().optional(),
	// The transaction the dialog started from, whose key the bill takes.
	entryId: z.string().nullable().optional(),
});

export type DeclareInput = z.input<typeof declareBodySchema>;

export const editBodySchema = z.object({
	name: z.string().nullable().optional(),
	amount: z.string().optional(),
	accountId: z.string().optional(),
	billType: z.string().optional(),
	categoryId: z.string().nullable().optional(),
	frequency: frequencyBody.optional(),
	endAfterCount: z.string().optional(),
	autopay: z.boolean().optional(),
	notes: z.string().nullable().optional(),
	paymentUrl: z.string().nullable().optional(),
});

export type EditInput = z.input<typeof editBodySchema>;

/**
 * A scheme followed by `//` or by anything but a port, as Sure's
 * `EXPLICIT_SCHEME`: `example.com:8080` is a host and a port.
 */
const EXPLICIT_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:(?:\/\/|(?!\d))/u;

/**
 * Sure's `normalize_payment_url`: trimmed, blank is none, a bare host gets
 * `https://`, and a link with a scheme stays as typed for the check to judge.
 */
function normalizePaymentUrl(text: string | null): string | null {
	const trimmed = text?.trim() ?? "";

	if (trimmed === "") {
		return null;
	}

	return EXPLICIT_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * Sure's `valid_payment_url?`: `http` or `https` with a host and nothing
 * else, the boundary that keeps a `javascript:` link from ever being one.
 */
function isPaymentUrl(url: string): boolean {
	try {
		const parsed = new URL(url);

		return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname !== "";
	} catch {
		return false;
	}
}

const paymentUrl = z
	.string()
	.nullable()
	.transform(normalizePaymentUrl)
	.superRefine((url, context) => {
		if (url !== null && !isPaymentUrl(url)) {
			context.addIssue({ code: "custom", message: "invalid_url" });
		}
	})
	.pipe(z.string().max(NOTES_MAX_LENGTH).nullable());

/** A blank note is no note. */
const notes = z
	.string()
	.trim()
	.max(NOTES_MAX_LENGTH)
	.nullable()
	.transform((value) => (value === null || value === "" ? null : value));

/** NFC: a pasted « Été » may arrive decomposed. */
const name = z
	.string()
	.trim()
	.transform((value) => value.normalize("NFC"))
	.pipe(z.string().min(1).max(LABEL_MAX_LENGTH));

/** A whole number written without sign or decimals, within `min` and `max`, else `code`. */
function wholeNumber(min: number, max: number, code: string) {
	return z
		.string()
		.trim()
		.transform((text, context) => {
			const value = /^-?\d{1,3}$/u.test(text) ? Number(text) : Number.NaN;

			if (!(value >= min && value <= max)) {
				context.addIssue({ code: "custom", message: code });

				return z.NEVER;
			}

			return value;
		});
}

/** A day of the month, the last being −1, as the picker's « Le jour ». */
const dayOfMonth = wholeNumber(LAST_DAY_OF_MONTH, 31, "invalid_value").refine(
	(day) => day !== 0,
	"invalid_value",
);

/**
 * The frequency picker, as Sure's: a preset, or every N weeks, months or
 * years, N from 1 to 99, and on an edit the day fields the cadence asks for.
 * `custom` reads a shape no preset expresses and leaves it as it is, so only
 * an edit offers it.
 */
function frequencySchema(presets: readonly [string, ...string[]]) {
	return z
		.object({
			preset: z.enum(presets),
			interval: z.string().trim().default(""),
			unit: z.string().default("monthly"),
			dayOfMonth: dayOfMonth.optional(),
			secondDayOfMonth: dayOfMonth.optional(),
			weekday: wholeNumber(0, 6, "invalid_value").optional(),
			monthOfYear: wholeNumber(1, 12, "invalid_value").optional(),
		})
		.superRefine((value, context) => {
			if (value.preset !== INTERVAL_PRESET) {
				return;
			}

			if (!/^\d{1,2}$/u.test(value.interval) || !isValidInterval(Number(value.interval))) {
				context.addIssue({ code: "custom", path: ["interval"], message: "invalid_interval" });
			}

			if (!RECURRENCE_FREQUENCIES.some((unit) => unit === value.unit)) {
				context.addIssue({ code: "custom", path: ["unit"], message: "invalid_value" });
			}
		})
		.transform((value): FrequencyChoice => {
			const days = {
				dayOfMonth: value.dayOfMonth ?? null,
				secondDayOfMonth: value.secondDayOfMonth ?? null,
				weekday: value.weekday ?? null,
				monthOfYear: value.monthOfYear ?? null,
			};
			const unit = RECURRENCE_FREQUENCIES.find((candidate) => candidate === value.unit);

			if (value.preset === INTERVAL_PRESET && unit !== undefined) {
				return { ...days, preset: INTERVAL_PRESET, interval: Number(value.interval), unit };
			}

			const preset = FREQUENCY_PRESETS.find((candidate) => candidate === value.preset);

			// The refinement above has refused an interval it cannot read.
			return { ...days, preset: preset ?? CUSTOM_PRESET };
		});
}

/**
 * Sure's `DeclaredBill`: a name, a positive amount in the account's currency,
 * the account, the first due date and how often, optionally its type and
 * category, autopay, notes and a payment link. Built per currency and shared with the dialog's
 * resolver, so both report the same field codes. Whether the account and the
 * transaction exist needs the database: the service checks it.
 */
export function declareBillSchema(currency: CurrencyCode) {
	return z.object({
		kind: z.enum(BILL_KINDS),
		name,
		amount: z.string().trim().min(1).transform(amountIn(currency, true)),
		accountId: z.string().min(1),
		firstDueOn: z.iso.date(),
		frequency: frequencySchema([...FREQUENCY_PRESETS, INTERVAL_PRESET]),
		billType: z.enum(EDITABLE_BILL_TYPES).default("bill"),
		categoryId: z.string().min(1).nullable().default(null),
		autopay: z.boolean().default(false),
		notes: notes.default(null),
		paymentUrl: paymentUrl.default(null),
		entryId: z.string().min(1).nullable().default(null),
	});
}

/** What the declare dialog holds: the text typed, before the schema parses it. */
export type DeclareFormInput = z.input<ReturnType<typeof declareBillSchema>>;

/**
 * The edit dialog's fields, each optional, an absent one left as it is: the
 * name, blank for none, a positive amount whose sign the series keeps, the
 * account, the type, the category, the frequency, the number of payments of
 * an installment, autopay, notes and the payment link.
 */
export function editBillSchema(currency: CurrencyCode) {
	return z.object({
		name: z
			.string()
			.trim()
			.nullable()
			.transform((value) => (value === null || value === "" ? null : value.normalize("NFC")))
			.pipe(z.string().max(LABEL_MAX_LENGTH).nullable())
			.optional(),
		amount: z.string().trim().min(1).transform(amountIn(currency, true)).optional(),
		accountId: z.string().min(1).optional(),
		billType: z.enum(EDITABLE_BILL_TYPES).optional(),
		categoryId: z.string().min(1).nullable().optional(),
		frequency: frequencySchema([...FREQUENCY_PRESETS, INTERVAL_PRESET, CUSTOM_PRESET]).optional(),
		// Blank is none.
		endAfterCount: z
			.string()
			.trim()
			.transform((text) => (text === "" ? null : text))
			.pipe(wholeNumber(1, MAX_END_AFTER_COUNT, "invalid_count").nullable())
			.optional(),
		autopay: z.boolean().optional(),
		notes: notes.optional(),
		paymentUrl: paymentUrl.optional(),
	});
}

/** What the edit dialog holds: the text typed, before the schema parses it. */
export type EditFormInput = z.input<ReturnType<typeof editBillSchema>>;

/**
 * Sure's `BillsController::STATUS_FILTERS`: the current occurrence's payment
 * state, then the two lifecycle values, `paused` reading `inactive`.
 */
export const BILL_STATUS_FILTERS = [
	"overdue",
	"due",
	"partial",
	"paid",
	"paused",
	"ended",
] as const;

export type BillStatusFilter = (typeof BILL_STATUS_FILTERS)[number];

/** Sure's `bills/all` sorts: by next due date, the default, by name or by amount. */
export const BILL_SORTS = ["due", "name", "amount"] as const;

export type BillSort = (typeof BILL_SORTS)[number];

/** `GET /api/recurring/bills/all`: Sure's `q[search]`, `q[status]`, `q[bill_type]` and `q[sort]`. */
export const allBillsQuerySchema = z.object({
	q: z
		.string()
		.trim()
		.max(200)
		.transform((value) => (value === "" ? undefined : value))
		.optional(),
	status: z.enum(BILL_STATUS_FILTERS).optional(),
	type: z.enum(BILL_TYPES).optional(),
	sort: z.enum(BILL_SORTS).default("due"),
});

export type AllBillsQuery = z.output<typeof allBillsQuerySchema>;

/**
 * Sure's `GetBills` lifecycle words: `paused` reads the stored `inactive`,
 * and `all` every status, suggestions included.
 */
export const BILL_LIFECYCLES = ["active", "suggested", "paused", "ended", "all"] as const;

export type BillLifecycle = (typeof BILL_LIFECYCLES)[number];

/** A bill's status in those words: every lifecycle but `all`. */
export const billStatusSchema = z.enum(BILL_LIFECYCLES).exclude(["all"]);

export type BillStatus = z.infer<typeof billStatusSchema>;

/** Sure's `GetBills` payment states, read on the current occurrence. */
export const BILL_PAYMENT_STATES = ["overdue", "due", "upcoming", "partial", "paid"] as const;

export type BillPaymentState = (typeof BILL_PAYMENT_STATES)[number];
