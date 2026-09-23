import { z } from "zod";

import type { CurrencyCode } from "@archant/data/money";
import { parseAmount } from "@archant/data/money";

export const LABEL_MAX_LENGTH = 200;
export const NOTES_MAX_LENGTH = 2000;

// What the route checks before it knows the account: every field is text, so
// the typed client knows the body's shape. The amount is parsed afterwards,
// with the account's currency, by the schemas below.
export const transactionBodySchema = z.object({
	date: z.string(),
	label: z.string(),
	// Signed text, not a number: the minor units depend on the currency, and a
	// JavaScript number would already have rounded the input.
	amount: z.string(),
	notes: z.string().nullable().optional(),
});

// Exclusion, category and merchant are edits only: a new transaction is always
// counted, and starts « Sans catégorie » and « Sans marchand ».
export const transactionPatchBodySchema = transactionBodySchema.partial().extend({
	excluded: z.boolean().optional(),
	// `null` clears it; the ledger checks that the id names a category.
	categoryId: z.string().nullable().optional(),
	// `null` clears it; the ledger checks that the id names a merchant.
	merchantId: z.string().nullable().optional(),
});

export type TransactionInput = z.input<typeof transactionBodySchema>;
export type TransactionPatchInput = z.input<typeof transactionPatchBodySchema>;

const fields = {
	date: z.iso.date(),
	label: z.string().trim().min(1).max(LABEL_MAX_LENGTH),
	amount: z.string(),
	// A blank note is no note.
	notes: z
		.string()
		.trim()
		.max(NOTES_MAX_LENGTH)
		.nullable()
		.optional()
		.transform((value) => (value === undefined || value === "" ? null : value)),
};

function amountIn(currency: CurrencyCode) {
	return (value: { amount?: unknown }, context: z.core.$RefinementCtx) => {
		if (typeof value.amount === "string" && parseAmount(value.amount, currency) === null) {
			context.addIssue({ code: "custom", path: ["amount"], message: "invalid_amount" });
		}
	};
}

/**
 * The full check of a new transaction, shared with the interface's form
 * resolver, so a value the form accepts is one the API accepts, with the same
 * field codes. Built per currency: `12,345` is invalid in euros and fine in
 * dinars. The amount check runs in a refinement so a blank label and a bad
 * amount are reported together.
 */
export function createTransactionSchema(currency: CurrencyCode) {
	return z
		.object(fields)
		.superRefine(amountIn(currency))
		.transform((value, context) => {
			const amount = parseAmount(value.amount, currency);

			if (amount === null) {
				// Already reported by the refinement; kept so the output type never
				// has to pretend.
				context.addIssue({ code: "custom", path: ["amount"], message: "invalid_amount" });

				return z.NEVER;
			}

			return { ...value, amount };
		});
}

/** The edit counterpart: every field optional, an absent one left as it is. */
export function updateTransactionSchema(currency: CurrencyCode) {
	return z
		.object({
			date: fields.date.optional(),
			label: fields.label.optional(),
			amount: fields.amount.optional(),
			notes: z.string().trim().max(NOTES_MAX_LENGTH).nullable().optional(),
			excluded: z.boolean().optional(),
			categoryId: z.string().min(1).nullable().optional(),
			merchantId: z.string().min(1).nullable().optional(),
		})
		.superRefine(amountIn(currency))
		.transform(({ amount: text, notes, ...rest }) => {
			const amount = text === undefined ? null : parseAmount(text, currency);

			return {
				...rest,
				...(amount === null ? {} : { amount }),
				...(notes === undefined ? {} : { notes: notes === "" ? null : notes }),
			};
		});
}

/**
 * The interface's sheet: the fields of a new transaction plus the exclusion
 * switch, the category and the merchant, checked the way the API checks them. The form
 * sends the typed text as is; the create or update schema parses it on the
 * server.
 */
export function transactionFormSchema(currency: CurrencyCode) {
	return z
		.object({
			...fields,
			excluded: z.boolean(),
			categoryId: z.string().nullable(),
			merchantId: z.string().nullable(),
		})
		.superRefine(amountIn(currency));
}

/** What the interface's form holds: the text typed, before the schema parses it. */
export type TransactionFormInput = z.input<ReturnType<typeof transactionFormSchema>>;
export type CreateTransactionRequest = z.output<ReturnType<typeof createTransactionSchema>>;
export type UpdateTransactionRequest = z.output<ReturnType<typeof updateTransactionSchema>>;

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export const pageQuerySchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

/**
 * A non-negative decimal read exactly, `units / 10^scale`. Structurally the
 * domain's `DecimalAmount`, which this file may not import.
 */
export type AmountBound = { units: bigint; scale: number };

// The unsigned shapes `parseAmount` reads: `1 234,56`, `42.90`, `20`. Fifteen
// integer digits is already past any stored amount; ten decimals, past any
// currency's minor unit.
const BOUND_PATTERN = /^(\d{1,3}(?:[ \u00A0\u202F]\d{3})+|\d{1,15})(?:[.,](\d{1,10}))?$/u;

/**
 * Reads an amount filter bound, before any currency is known: the list spans
 * accounts in several currencies, and each scales the bound its own way.
 * `null` for anything else, a sign included: the bound is on the absolute
 * value, and the sign is the direction filter's (Epic 5).
 */
export function parseAmountBound(text: string): AmountBound | null {
	const match = BOUND_PATTERN.exec(text.trim());

	if (match === null) {
		return null;
	}

	const [, integerPart = "", fraction = ""] = match;

	return { units: BigInt(integerPart.replace(/\D/gu, "") + fraction), scale: fraction.length };
}

const isBound = (value: AmountBound | null | undefined): value is AmountBound =>
	value !== null && value !== undefined;

/** Negative, zero or positive as `a` is below, equal to or above `b`. */
export function compareAmountBounds(a: AmountBound, b: AmountBound): number {
	const scale = Math.max(a.scale, b.scale);
	const left = a.units * 10n ** BigInt(scale - a.scale);
	const right = b.units * 10n ** BigInt(scale - b.scale);

	return left === right ? 0 : left < right ? -1 : 1;
}

export const MAX_ACCOUNT_FILTER = 100;
export const MAX_CATEGORY_FILTER = MAX_ACCOUNT_FILTER;
export const MAX_MERCHANT_FILTER = MAX_ACCOUNT_FILTER;

/** The `category` filter value that stands for « Sans catégorie ». */
export const UNCATEGORISED = "none";
export const SEARCH_MAX_LENGTH = 200;

const optionalText = z
	.string()
	.trim()
	.optional()
	.transform((value) => (value === "" ? undefined : value));

/** A query key that repeats, one value each; a lone one arrives as a string. */
function repeated(max: number) {
	return z
		.union([z.string(), z.array(z.string())])
		.optional()
		.transform((value) => (typeof value === "string" ? [value] : value))
		.pipe(z.array(z.string().min(1)).max(max).optional());
}

/**
 * The query of the cross-account list. `account`, `category` and `merchant`
 * repeat, one id each, `none` standing for « Sans catégorie ». Dates are inclusive,
 * amounts bound the absolute value, `q` searches the label and the notes.
 */
export const transactionFilterSchema = pageQuerySchema
	.extend({
		account: repeated(MAX_ACCOUNT_FILTER),
		category: repeated(MAX_CATEGORY_FILTER),
		merchant: repeated(MAX_MERCHANT_FILTER),
		from: z.iso.date().optional(),
		to: z.iso.date().optional(),
		amountMin: optionalText,
		amountMax: optionalText,
		q: optionalText.pipe(z.string().max(SEARCH_MAX_LENGTH).optional()),
	})
	.superRefine((value, context) => {
		if (value.from !== undefined && value.to !== undefined && value.to < value.from) {
			context.addIssue({ code: "custom", path: ["to"], message: "before_from" });
		}

		const min = value.amountMin === undefined ? undefined : parseAmountBound(value.amountMin);
		const max = value.amountMax === undefined ? undefined : parseAmountBound(value.amountMax);

		if (min === null) {
			context.addIssue({ code: "custom", path: ["amountMin"], message: "invalid_amount" });
		}

		if (max === null) {
			context.addIssue({ code: "custom", path: ["amountMax"], message: "invalid_amount" });
		}

		if (isBound(min) && isBound(max) && compareAmountBounds(min, max) > 0) {
			context.addIssue({ code: "custom", path: ["amountMax"], message: "below_min" });
		}
	})
	.transform(({ amountMin, amountMax, ...rest }) => {
		const min = amountMin === undefined ? null : parseAmountBound(amountMin);
		const max = amountMax === undefined ? null : parseAmountBound(amountMax);

		return {
			...rest,
			...(min === null ? {} : { amountMin: min }),
			...(max === null ? {} : { amountMax: max }),
		};
	});

export type TransactionFilterQuery = z.input<typeof transactionFilterSchema>;
export type TransactionFilterRequest = z.output<typeof transactionFilterSchema>;
