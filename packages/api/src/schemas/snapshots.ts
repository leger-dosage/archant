import { z } from "zod";

import type { CurrencyCode } from "@archant/data/money";
import { parseAmount } from "@archant/data/money";

import { entryDateSchema } from "./accounts.ts";
import { NOTES_MAX_LENGTH } from "./transactions.ts";

// What the route checks before it knows the account: every field is text,
// so the typed client knows the body's shape. The balance is parsed
// afterwards, with the account's currency, by the schemas below.
export const snapshotBodySchema = z.object({
	date: z.string(),
	// Signed text, not a number: a checking account can be overdrawn, and a
	// JavaScript number would already have rounded the input.
	balance: z.string(),
	// Sure's valuation notes. Its « Nouveau solde » form has none and its
	// drawer edits them, as the dialog here; its API takes them on both.
	notes: z.string().nullable().optional(),
});

export const snapshotPatchBodySchema = snapshotBodySchema.partial();

export type SnapshotInput = z.input<typeof snapshotBodySchema>;
export type SnapshotPatchInput = z.input<typeof snapshotPatchBodySchema>;

// A transaction's limit. Absent, the notes are left as they are.
const notes = z.string().trim().max(NOTES_MAX_LENGTH).nullable().optional();

/** Blank notes are no notes. */
function notesOf(value: string | null | undefined): { notes?: string | null } {
	return value === undefined ? {} : { notes: value === "" ? null : value };
}

function balanceIn(currency: CurrencyCode) {
	return (value: { balance?: unknown }, context: z.core.$RefinementCtx) => {
		if (typeof value.balance !== "string") {
			return;
		}

		// Sure's `valuations.errors.amount_required`: a blank amount is missing,
		// not malformed, and the form says so before any request.
		if (value.balance.trim() === "") {
			context.addIssue({ code: "custom", path: ["balance"], message: "amount_required" });
		} else if (parseAmount(value.balance, currency) === null) {
			context.addIssue({ code: "custom", path: ["balance"], message: "invalid_amount" });
		}
	};
}

/**
 * The full check of a new snapshot, shared with the interface's form resolver
 * so both report the same field codes. Built per currency: `12,345` is
 * invalid in euros and fine in dinars.
 */
export function createSnapshotSchema(currency: CurrencyCode) {
	return z
		.object({ date: entryDateSchema, balance: z.string(), notes })
		.superRefine(balanceIn(currency))
		.transform((value, context) => {
			const balance = parseAmount(value.balance, currency);

			if (balance === null) {
				// Already reported by the refinement; kept so the output type never
				// has to pretend.
				context.addIssue({ code: "custom", path: ["balance"], message: "invalid_amount" });

				return z.NEVER;
			}

			return { date: value.date, balance, ...notesOf(value.notes) };
		});
}

/** The edit counterpart: every field optional, an absent one left as it is. */
export function updateSnapshotSchema(currency: CurrencyCode) {
	return z
		.object({ date: entryDateSchema.optional(), balance: z.string().optional(), notes })
		.superRefine(balanceIn(currency))
		.transform(({ balance: text, notes: written, ...rest }) => {
			const balance = text === undefined ? null : parseAmount(text, currency);

			return { ...rest, ...(balance === null ? {} : { balance }), ...notesOf(written) };
		});
}

/** What the interface's form holds: the text typed, before the schema parses it. */
export type SnapshotFormInput = z.input<ReturnType<typeof createSnapshotSchema>>;

/**
 * The full check of an opening balance, shared with the « Solde d'ouverture »
 * sheet: a new snapshot's fields, the date required, parsed in the account's
 * currency. Where the date may fall needs the account's entries, so the
 * ledger checks it. The route takes `snapshotBodySchema`.
 */
export function openingBalanceSchema(currency: CurrencyCode) {
	// `entryDateSchema` already refuses a date before 1900, as an account's creation does.
	return createSnapshotSchema(currency);
}
