import { z } from "zod";

import type { CurrencyCode } from "@archant/data/money";
import { parseAmount, toMinorUnits } from "@archant/data/money";

import { entryDateSchema } from "./accounts.ts";
import { MAX_TAGS_PER_TRANSACTION, NOTES_MAX_LENGTH } from "./transactions.ts";

/** Matching a transaction with the counterpart the user picked from its candidates. */
export const transferBodySchema = z.object({
	transactionId: z.string().min(1),
	counterpartId: z.string().min(1),
});

export type TransferInput = z.input<typeof transferBodySchema>;
export type TransferRequest = z.output<typeof transferBodySchema>;

/** Sure's `transfers#update` from the drawer: the outflow's category and the notes. */
export const transferPatchSchema = z.object({
	categoryId: z.string().min(1).nullable().optional(),
	// A blank note is no note.
	notes: z
		.string()
		.trim()
		.max(NOTES_MAX_LENGTH)
		.nullable()
		.optional()
		.transform((value) => (value === "" ? null : value)),
});

export type TransferPatchInput = z.input<typeof transferPatchSchema>;

/** Sure's `update_tags`: the whole set, for both sides; `[]` removes every tag. */
export const transferTagsSchema = z.object({
	// Repeats are dropped before the cap counts, as a transaction's tags.
	tagIds: z
		.array(z.string().min(1))
		.transform((ids) => [...new Set(ids)])
		.pipe(z.array(z.string()).max(MAX_TAGS_PER_TRANSACTION)),
});

export type TransferTagsInput = z.input<typeof transferTagsSchema>;

// What the route checks before it knows the source account: the amounts stay
// text, parsed in its currency by `newTransferSchema`.
export const newTransferBodySchema = z.object({
	fromAccountId: z.string(),
	toAccountId: z.string(),
	date: z.string(),
	amount: z.string(),
	sourceFee: z.string().optional(),
	destinationFee: z.string().optional(),
	tagIds: z.array(z.string()).optional(),
	// Sure's `idempotency_key`: a UUID the form draws once, sent with each submit.
	idempotencyKey: z.uuid().optional(),
});

export type NewTransferInput = z.input<typeof newTransferBodySchema>;

/** A fee as the form sends it: blank is none, else zero or above. */
function feeIn(currency: CurrencyCode) {
	return z
		.string()
		.trim()
		.optional()
		.transform((text, context) => {
			if (text === undefined || text === "") {
				return toMinorUnits(0);
			}

			const fee = parseAmount(text, currency);

			if (fee === null) {
				context.addIssue({ code: "custom", message: "invalid_amount" });

				return z.NEVER;
			}

			if (fee < 0) {
				context.addIssue({ code: "custom", message: "negative_amount" });

				return z.NEVER;
			}

			return fee;
		});
}

/**
 * The full check of a new transfer, in the source account's currency, shared
 * with the interface's form: the amount above zero, each fee zero or above,
 * as Sure's `Transfer::Creator`, all in integer minor units.
 */
export function newTransferSchema(currency: CurrencyCode) {
	return z.object({
		fromAccountId: z.string().min(1),
		toAccountId: z.string().min(1),
		date: entryDateSchema,
		amount: z
			.string()
			.trim()
			.transform((text, context) => {
				const amount = parseAmount(text, currency);

				if (amount === null) {
					context.addIssue({ code: "custom", message: "invalid_amount" });

					return z.NEVER;
				}

				if (amount <= 0) {
					context.addIssue({ code: "custom", message: "not_positive" });

					return z.NEVER;
				}

				return amount;
			}),
		sourceFee: feeIn(currency),
		destinationFee: feeIn(currency),
		// Repeats are dropped before the cap counts, as a transaction's tags.
		tagIds: z
			.array(z.string().min(1))
			.transform((ids) => [...new Set(ids)])
			.pipe(z.array(z.string()).max(MAX_TAGS_PER_TRANSACTION))
			.default([]),
		idempotencyKey: z.uuid().optional(),
	});
}

export type NewTransferFormInput = z.input<ReturnType<typeof newTransferSchema>>;
export type NewTransfer = z.output<ReturnType<typeof newTransferSchema>>;
