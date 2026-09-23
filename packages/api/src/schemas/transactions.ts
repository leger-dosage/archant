import { z } from "zod";

import type { CurrencyCode } from "@archant/data/money";
import { parseAmount } from "@archant/data/money";

export const LABEL_MAX_LENGTH = 200;
export const NOTES_MAX_LENGTH = 2000;
/** Past this a tag stops telling a trip apart; the route refuses a larger set. */
export const MAX_TAGS_PER_TRANSACTION = 20;

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

// Exclusion, category, merchant and tags are edits only: a new transaction is
// always counted, and starts « Sans catégorie », « Sans marchand » and untagged.
export const transactionPatchBodySchema = transactionBodySchema.partial().extend({
	excluded: z.boolean().optional(),
	// `null` clears it; the ledger checks that the id names a category.
	categoryId: z.string().nullable().optional(),
	// `null` clears it; the ledger checks that the id names a merchant.
	merchantId: z.string().nullable().optional(),
	// The whole set; the ledger checks that every id names a tag.
	tagIds: z.array(z.string()).optional(),
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
			// Repeats are dropped before the cap counts, so a double click never refuses.
			tagIds: z
				.array(z.string().min(1))
				.transform((ids) => [...new Set(ids)])
				.pipe(z.array(z.string()).max(MAX_TAGS_PER_TRANSACTION))
				.optional(),
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
 * switch, the category, the merchant and the tags, checked the way the API checks them. The form
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
			tagIds: z.array(z.string()).max(MAX_TAGS_PER_TRANSACTION),
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
export const MAX_TAG_FILTER = MAX_ACCOUNT_FILTER;

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

const filterFields = {
	account: repeated(MAX_ACCOUNT_FILTER),
	category: repeated(MAX_CATEGORY_FILTER),
	merchant: repeated(MAX_MERCHANT_FILTER),
	tag: repeated(MAX_TAG_FILTER),
	from: z.iso.date().optional(),
	to: z.iso.date().optional(),
	amountMin: optionalText,
	amountMax: optionalText,
	q: optionalText.pipe(z.string().max(SEARCH_MAX_LENGTH).optional()),
};

type FilterFields = {
	from?: string | undefined;
	to?: string | undefined;
	amountMin?: string | undefined;
	amountMax?: string | undefined;
};

function checkFilter(value: FilterFields, context: z.core.$RefinementCtx) {
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
}

function parseBounds<Value extends FilterFields>({ amountMin, amountMax, ...rest }: Value) {
	const min = amountMin === undefined ? null : parseAmountBound(amountMin);
	const max = amountMax === undefined ? null : parseAmountBound(amountMax);

	return {
		...rest,
		...(min === null ? {} : { amountMin: min }),
		...(max === null ? {} : { amountMax: max }),
	};
}

/**
 * The query of the cross-account list. `account`, `category`, `merchant` and
 * `tag` repeat, one id each, `none` standing for « Sans catégorie ». Dates are inclusive,
 * amounts bound the absolute value, `q` searches the label and the notes.
 */
export const transactionFilterSchema = pageQuerySchema
	.extend(filterFields)
	.superRefine(checkFilter)
	.transform(parseBounds);

/**
 * The list's filter without its page, as a bulk action sends it for « Tout
 * sélectionner ». The same shape as the query, so the interface sends its
 * search params as they are. Strict: a key renamed on one side only would
 * otherwise be dropped, and the filter would widen to every transaction.
 */
export const bulkFilterSchema = z
	.strictObject(filterFields)
	.superRefine(checkFilter)
	.transform(parseBounds);

export type TransactionFilterQuery = z.input<typeof transactionFilterSchema>;
export type TransactionFilterRequest = z.output<typeof transactionFilterSchema>;
export type BulkFilterRequest = z.output<typeof bulkFilterSchema>;

/**
 * The largest selection sent as ids: the list's largest page. Past it, the
 * interface sends the filter, which « Tout sélectionner » covers.
 */
export const MAX_BULK_IDS = MAX_PAGE_SIZE;

// Repeats are dropped before the bounds count, so a row ticked twice never refuses.
const bulkIds = z
	.array(z.string().min(1))
	.transform((ids) => [...new Set(ids)])
	.pipe(z.array(z.string()).min(1).max(MAX_BULK_IDS));

const selectionFields = { ids: bulkIds.optional(), filter: bulkFilterSchema.optional() };

type SelectionFields = {
	ids?: string[] | undefined;
	filter?: BulkFilterRequest | undefined;
};

/** The rows a bulk action targets: exactly one of `ids` and `filter`. */
export type BulkSelectionRequest = { ids: string[] } | { filter: BulkFilterRequest };

/**
 * Moves `ids` or `filter` into `selection`, refusing both or neither on
 * `selection`: a missing filter must not read as « every transaction ».
 */
function toSelection<Value extends SelectionFields>(
	{ ids, filter, ...rest }: Value,
	context: z.core.$RefinementCtx,
) {
	if ((ids === undefined) === (filter === undefined)) {
		context.addIssue({ code: "custom", path: ["selection"], message: "ids_or_filter" });

		return z.NEVER;
	}

	const selection: BulkSelectionRequest = ids === undefined ? { filter: filter ?? {} } : { ids };

	return { ...rest, selection };
}

/** What a bulk edit may change: at least one field, each as in the single edit. */
export const bulkPatchSchema = z
	.object({
		// `null` clears it; the ledger checks that the id names a category.
		categoryId: z.string().min(1).nullable().optional(),
		// `null` clears it; the ledger checks that the id names a merchant.
		merchantId: z.string().min(1).nullable().optional(),
		// Added to each row's tags, never replacing them; the ledger checks the ids and each row's cap.
		addTagIds: z
			.array(z.string().min(1))
			.transform((ids) => [...new Set(ids)])
			.pipe(z.array(z.string()).min(1).max(MAX_TAGS_PER_TRANSACTION))
			.optional(),
		excluded: z.boolean().optional(),
	})
	.refine((patch) => Object.values(patch).some((value) => value !== undefined), {
		message: "empty_patch",
	});

export const bulkUpdateBodySchema = z
	.object({ ...selectionFields, patch: bulkPatchSchema })
	.transform(toSelection);

export const bulkDeleteBodySchema = z.object(selectionFields).transform(toSelection);

export type BulkUpdateInput = z.input<typeof bulkUpdateBodySchema>;
export type BulkUpdateRequest = z.output<typeof bulkUpdateBodySchema>;
export type BulkDeleteInput = z.input<typeof bulkDeleteBodySchema>;
export type BulkDeleteRequest = z.output<typeof bulkDeleteBodySchema>;
