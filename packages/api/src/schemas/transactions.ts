import { z } from "zod";

import { ACTIVITY_LABELS } from "@archant/data/activity-labels";
import type { CurrencyCode } from "@archant/data/money";
import { parseAmount } from "@archant/data/money";

import { DIRECTIONS } from "../domain/cash-flow.ts";
import { entryDateSchema } from "./accounts.ts";

export const LABEL_MAX_LENGTH = 200;
export const NOTES_MAX_LENGTH = 2000;
/** Past this a tag stops telling a trip apart; the route refuses a larger set. */
export const MAX_TAGS_PER_TRANSACTION = 20;
/**
 * The most lines a split holds. Sure sets none; one receipt's lines fit well
 * below it. The body limit still applies: fifty lines with long notes exceed
 * it, and the route answers `PAYLOAD_TOO_LARGE` before any field check.
 */
export const MAX_SPLIT_LINES = 50;

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
	// Sure's `one_time` kind; only this edit sets it, never a sync, an import or a rule.
	oneTime: z.boolean().optional(),
	// `null` clears it; the ledger checks that the id names a category.
	categoryId: z.string().nullable().optional(),
	// `null` clears it; the ledger checks that the id names a merchant.
	merchantId: z.string().nullable().optional(),
	// The whole set; the ledger checks that every id names a tag.
	tagIds: z.array(z.string()).optional(),
	// Sure's `investment_activity_label`; `null` clears it. Only this edit sets it.
	investmentActivityLabel: z.enum(ACTIVITY_LABELS).nullable().optional(),
});

// A split's body as the route checks it before it knows the account: the
// amounts are text, parsed with the account's currency by
// `splitTransactionSchema`.
export const splitBodySchema = z.object({
	lines: z.array(
		z.object({
			id: z.string().optional(),
			label: z.string(),
			amount: z.string(),
			categoryId: z.string().nullable(),
			tagIds: z.array(z.string()).optional(),
			notes: z.string().nullable().optional(),
		}),
	),
});

export type SplitInput = z.input<typeof splitBodySchema>;

/** Merging a possible duplicate into the candidate the user picked. */
export const mergeDuplicateBodySchema = z.object({ into: z.string().min(1) });

export type MergeDuplicateInput = z.input<typeof mergeDuplicateBodySchema>;
export type MergeDuplicateRequest = z.output<typeof mergeDuplicateBodySchema>;

/** « Ouvrir la fusion »'s page: an offset below zero is refused, where Sure's `[offset, 0].max` clamps it. */
export const pendingMergeCandidatesSchema = z.object({
	offset: z.coerce.number().int().min(0).default(0),
});

export type PendingMergeCandidatesQuery = z.output<typeof pendingMergeCandidatesSchema>;

export type TransactionInput = z.input<typeof transactionBodySchema>;
export type TransactionPatchInput = z.input<typeof transactionPatchBodySchema>;

const fields = {
	date: entryDateSchema,
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
			oneTime: z.boolean().optional(),
			categoryId: z.string().min(1).nullable().optional(),
			merchantId: z.string().min(1).nullable().optional(),
			// Repeats are dropped before the cap counts, so a double click never refuses.
			tagIds: z
				.array(z.string().min(1))
				.transform((ids) => [...new Set(ids)])
				.pipe(z.array(z.string()).max(MAX_TAGS_PER_TRANSACTION))
				.optional(),
			investmentActivityLabel: z.enum(ACTIVITY_LABELS).nullable().optional(),
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
 * The full check of a split's lines, with the same field codes as a
 * transaction's, under `lines.N`: one to `MAX_SPLIT_LINES` lines, each a
 * label, an amount in `currency` and a category or `null`. A line's id names
 * a child kept in place, and its absent tags or notes are left as they are;
 * a blank note is no note. That the lines sum to the parent is the ledger's
 * to check, on `lines`.
 */
export function splitTransactionSchema(currency: CurrencyCode) {
	const line = z
		.object({
			id: z.string().min(1).optional(),
			label: fields.label,
			amount: fields.amount,
			categoryId: z.string().min(1).nullable(),
			tagIds: z
				.array(z.string().min(1))
				.transform((ids) => [...new Set(ids)])
				.pipe(z.array(z.string()).max(MAX_TAGS_PER_TRANSACTION))
				.optional(),
			notes: z
				.string()
				.trim()
				.max(NOTES_MAX_LENGTH)
				.nullable()
				.optional()
				.transform((value) => (value === "" ? null : value)),
		})
		.superRefine(amountIn(currency))
		.transform(({ amount: text, ...rest }, context) => {
			const amount = parseAmount(text, currency);

			if (amount === null) {
				// Already reported by the refinement, as in `createTransactionSchema`.
				context.addIssue({ code: "custom", path: ["amount"], message: "invalid_amount" });

				return z.NEVER;
			}

			return { ...rest, amount };
		});

	return z.object({ lines: z.array(line).min(1).max(MAX_SPLIT_LINES) });
}

/**
 * The interface's sheet: the fields of a new transaction plus the exclusion
 * and one-time switches, the category, the merchant and the tags, checked the way the API checks them. The form
 * sends the typed text as is; the create or update schema parses it on the
 * server.
 */
export function transactionFormSchema(currency: CurrencyCode) {
	return z
		.object({
			...fields,
			excluded: z.boolean(),
			oneTime: z.boolean(),
			categoryId: z.string().nullable(),
			merchantId: z.string().nullable(),
			tagIds: z.array(z.string()).max(MAX_TAGS_PER_TRANSACTION),
		})
		.superRefine(amountIn(currency));
}

/** What the interface's form holds: the text typed, before the schema parses it. */
export type TransactionFormInput = z.input<ReturnType<typeof transactionFormSchema>>;
/** What the split dialog holds: each line's text typed, before the schema parses it. */
export type SplitFormInput = z.input<ReturnType<typeof splitTransactionSchema>>;
export type CreateTransactionRequest = z.output<ReturnType<typeof createTransactionSchema>>;
export type UpdateTransactionRequest = z.output<ReturnType<typeof updateTransactionSchema>>;

export const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export const pageQuerySchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

/**
 * A decimal read exactly, `units / 10^scale`, negative only as `less 0`'s upper
 * bound. Structurally the domain's `DecimalAmount`, which this file may not
 * import.
 */
export type AmountBound = { units: bigint; scale: number };

// The shapes `parseAmount` reads, `1 234,56`, `42.90`, `20`, with an optional
// sign. Fifteen integer digits is already past any stored amount; ten
// decimals, past any currency's minor unit.
const BOUND_PATTERN =
	/^[+\-\u2212]?\s*(\d{1,3}(?:[ \u00A0\u202F]\d{3})+|\d{1,15})(?:[.,](\d{1,10}))?$/u;

/**
 * Reads an amount filter bound, before any currency is known: the list spans
 * accounts in several currencies, and each scales the bound its own way.
 * The sign is dropped, as Sure's `amount.to_f.abs`: the amount is compared
 * with the absolute value, `-42,90` finding an expense and an income alike.
 * `null` for anything else, letters included, which Sure reads as 0.
 */
export function parseAmountBound(text: string): AmountBound | null {
	const match = BOUND_PATTERN.exec(text.trim());

	if (match === null) {
		return null;
	}

	const [, integerPart = "", fraction = ""] = match;

	return { units: BigInt(integerPart.replace(/\D/gu, "") + fraction), scale: fraction.length };
}

const MAX_ACCOUNT_FILTER = 100;
const MAX_CATEGORY_FILTER = MAX_ACCOUNT_FILTER;
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

/** One value of the `direction` filter, as `direction` in `domain/cash-flow.ts` returns it. */
export const directionSchema = z.enum(DIRECTIONS);

/** Sure's `amount_operator`, on the absolute amount. */
export const AMOUNT_OPERATORS = ["equal", "less", "greater"] as const;

export type AmountOperator = (typeof AMOUNT_OPERATORS)[number];

/** Sure's statuses: booked lines are `confirmed`. */
export const STATUSES = ["pending", "confirmed"] as const;

export type TransactionStatus = (typeof STATUSES)[number];

/**
 * Sure's `apply_status_filter` as the ledger's `pending`: both statuses, or
 * none, is no filter.
 */
export function pendingOf(statuses: readonly TransactionStatus[] | undefined): boolean | undefined {
	if (statuses === undefined || new Set(statuses).size !== 1) {
		return undefined;
	}

	return statuses[0] === "pending";
}

/** Past any currency's minor unit: `less` and `greater` are strict at every scale. */
const STRICT_SCALE = 5;

/** `bound` at `scale`, at least its own. */
function rescaled(bound: AmountBound, scale: number): AmountBound {
	return { units: bound.units * 10n ** BigInt(scale - bound.scale), scale };
}

/**
 * Sure's `amount` and `amount_operator` as the list's inclusive bounds on the
 * absolute amount: `equal` within 0.01, as Sure's `ABS(ABS(amount) - ?) <=
 * 0.01`; `less` and `greater` strict, one unit below any currency's minor
 * unit away from the amount, which each currency then rounds inward. `less 0`
 * gives an upper bound below zero, which matches nothing.
 */
export function operatorBounds(
	operator: AmountOperator,
	amount: AmountBound,
): { min?: AmountBound; max?: AmountBound } {
	if (operator === "equal") {
		const exact = rescaled(amount, Math.max(amount.scale, 2));
		const cent = 10n ** BigInt(exact.scale - 2);
		const low = exact.units - cent;

		return {
			min: { units: low < 0n ? 0n : low, scale: exact.scale },
			max: { units: exact.units + cent, scale: exact.scale },
		};
	}

	const fine = rescaled(amount, Math.max(amount.scale, STRICT_SCALE));

	return operator === "less"
		? { max: { units: fine.units - 1n, scale: fine.scale } }
		: { min: { units: fine.units + 1n, scale: fine.scale } };
}

const statusSchema = z.enum(STATUSES);

export const filterFields = {
	account: repeated(MAX_ACCOUNT_FILTER),
	// Repeats are dropped rather than refused: « Revenus » twice is still « Revenus ».
	direction: z
		.union([directionSchema, z.array(directionSchema)])
		.transform((value) => (typeof value === "string" ? [value] : [...new Set(value)]))
		.optional(),
	// Sure's « Statut »: `confirmed`, `pending`, or both, which is no filter.
	status: z
		.union([statusSchema, z.array(statusSchema)])
		.transform((value) => (typeof value === "string" ? [value] : [...new Set(value)]))
		.optional(),
	category: repeated(MAX_CATEGORY_FILTER),
	merchant: repeated(MAX_MERCHANT_FILTER),
	tag: repeated(MAX_TAG_FILTER),
	from: z.iso.date().optional(),
	to: z.iso.date().optional(),
	// Sure's one amount and its operator; either alone filters nothing, as
	// Sure's `apply_amount_filter`, whose form always sends both.
	amount: optionalText,
	amountOperator: z.enum(AMOUNT_OPERATORS).optional(),
	q: optionalText.pipe(z.string().max(SEARCH_MAX_LENGTH).optional()),
};

type FilterFields = {
	from?: string | undefined;
	to?: string | undefined;
	amount?: string | undefined;
};

/**
 * Where a refused field is reported: the query's key, or an assistant tool's.
 * A tool reads its amount as Sure's `to_f` does and checks none.
 */
export type FilterPaths = { to: string; amount?: string };

/** The filter's checks, each refusal under `paths`' name for its field. */
export function filterCheck(paths: FilterPaths) {
	return (value: FilterFields, context: z.core.$RefinementCtx) => {
		if (value.from !== undefined && value.to !== undefined && value.to < value.from) {
			context.addIssue({ code: "custom", path: [paths.to], message: "before_from" });
		}

		if (
			paths.amount !== undefined &&
			value.amount !== undefined &&
			parseAmountBound(value.amount) === null
		) {
			context.addIssue({ code: "custom", path: [paths.amount], message: "invalid_amount" });
		}
	};
}

const checkFilter = filterCheck({ to: "to", amount: "amount" });

type FilterParams = {
	status?: TransactionStatus[] | undefined;
	amount?: string | undefined;
	amountOperator?: AmountOperator | undefined;
};

/**
 * The status and the amount as the services read them: `pending`, and the
 * inclusive `amountMin` and `amountMax` bounds the operator gives.
 */
export function toLedgerFilter<Value extends FilterParams>({
	status,
	amount,
	amountOperator,
	...rest
}: Value) {
	const parsed = amount === undefined ? null : parseAmountBound(amount);
	const { min, max } =
		parsed === null || amountOperator === undefined ? {} : operatorBounds(amountOperator, parsed);
	const pending = pendingOf(status);

	return {
		...rest,
		...(min === undefined ? {} : { amountMin: min }),
		...(max === undefined ? {} : { amountMax: max }),
		...(pending === undefined ? {} : { pending }),
	};
}

/**
 * The query of the cross-account list. `account`, `category`, `merchant` and
 * `tag` repeat, one id each, `none` standing for « Sans catégorie »; `direction`
 * repeats `income`, `expense` or `transfer`, `status` `confirmed` or
 * `pending`. Dates are inclusive, `amount` is compared with the absolute value
 * by `amountOperator`, `q` searches the label and the notes.
 */
export const transactionFilterSchema = pageQuerySchema
	.extend(filterFields)
	.superRefine(checkFilter)
	.transform(toLedgerFilter);

/**
 * The query of `GET /api/transactions/totals`: the list's, without its page,
 * since the count and the sums are the same on every page.
 */
export const transactionTotalsSchema = z
	.object(filterFields)
	.superRefine(checkFilter)
	.transform(toLedgerFilter);

/**
 * The list's filter without its page, as a bulk action sends it for « Tout
 * sélectionner ». The same shape as the query, so the interface sends its
 * search params as they are. Strict: a key renamed on one side only would
 * otherwise be dropped, and the filter would widen to every transaction.
 */
export const bulkFilterSchema = z
	.strictObject(filterFields)
	.superRefine(checkFilter)
	.transform(toLedgerFilter);

export type TransactionFilterQuery = z.input<typeof transactionFilterSchema>;
export type TransactionFilterRequest = z.output<typeof transactionFilterSchema>;
export type TransactionTotalsRequest = z.output<typeof transactionTotalsSchema>;
export type BulkFilterRequest = z.output<typeof bulkFilterSchema>;

/**
 * The largest selection sent as ids: the list's largest page. Past it, the
 * interface sends the filter, which « Tout sélectionner » covers.
 */
export const MAX_BULK_IDS = MAX_PAGE_SIZE;

// Repeats are dropped before the bounds count, so a row ticked twice never refuses.
export const bulkIds = z
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

/** Sure's `compact_blank`: a blank or whitespace field changes nothing. */
const blankAsAbsent = (value: string) => (value === "" ? undefined : value);

/**
 * What a bulk edit may change, as Sure's `bulk_updates` drawer: at least one
 * field, a blank one absent. Nothing clears a category or a merchant, as in
 * Sure. Strict: a key the drawer no longer sends, such as `excluded`, is
 * refused rather than dropped, so a caller never believes it changed.
 */
export const bulkPatchSchema = z
	.strictObject({
		date: z.string().trim().transform(blankAsAbsent).pipe(entryDateSchema.optional()).optional(),
		name: z.string().trim().max(LABEL_MAX_LENGTH).transform(blankAsAbsent).optional(),
		notes: z.string().trim().max(NOTES_MAX_LENGTH).transform(blankAsAbsent).optional(),
		// The ledger checks that the id names a category.
		categoryId: z.string().trim().transform(blankAsAbsent).optional(),
		// The ledger checks that the id names a merchant.
		merchantId: z.string().trim().transform(blankAsAbsent).optional(),
		// The whole set, replacing each row's, as Sure's `tags_provided?`; `[]`
		// removes every tag. Repeats are dropped before the cap counts.
		tagIds: z
			.array(z.string().min(1))
			.transform((ids) => [...new Set(ids)])
			.pipe(z.array(z.string()).max(MAX_TAGS_PER_TRANSACTION))
			.optional(),
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
