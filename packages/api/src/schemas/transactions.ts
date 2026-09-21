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

export const transactionPatchBodySchema = transactionBodySchema.partial();

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

/** What the interface's form holds: the text typed, before the schema parses it. */
export type TransactionFormInput = z.input<ReturnType<typeof createTransactionSchema>>;
export type CreateTransactionRequest = z.output<ReturnType<typeof createTransactionSchema>>;
export type UpdateTransactionRequest = z.output<ReturnType<typeof updateTransactionSchema>>;

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export const pageQuerySchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
