import { z } from "zod";

import type { CurrencyCode } from "@archant/data/money";
import { parseAmount } from "@archant/data/money";

// What the route checks before it knows the account: both fields are text,
// so the typed client knows the body's shape. The balance is parsed
// afterwards, with the account's currency, by the schemas below.
export const snapshotBodySchema = z.object({
	date: z.string(),
	// Signed text, not a number: a checking account can be overdrawn, and a
	// JavaScript number would already have rounded the input.
	balance: z.string(),
});

export const snapshotPatchBodySchema = snapshotBodySchema.partial();

export type SnapshotInput = z.input<typeof snapshotBodySchema>;
export type SnapshotPatchInput = z.input<typeof snapshotPatchBodySchema>;

function balanceIn(currency: CurrencyCode) {
	return (value: { balance?: unknown }, context: z.core.$RefinementCtx) => {
		if (typeof value.balance === "string" && parseAmount(value.balance, currency) === null) {
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
		.object({ date: z.iso.date(), balance: z.string() })
		.superRefine(balanceIn(currency))
		.transform((value, context) => {
			const balance = parseAmount(value.balance, currency);

			if (balance === null) {
				// Already reported by the refinement; kept so the output type never
				// has to pretend.
				context.addIssue({ code: "custom", path: ["balance"], message: "invalid_amount" });

				return z.NEVER;
			}

			return { date: value.date, balance };
		});
}

/** The edit counterpart: both fields optional, an absent one left as it is. */
export function updateSnapshotSchema(currency: CurrencyCode) {
	return z
		.object({ date: z.iso.date().optional(), balance: z.string().optional() })
		.superRefine(balanceIn(currency))
		.transform(({ balance: text, ...rest }) => {
			const balance = text === undefined ? null : parseAmount(text, currency);

			return { ...rest, ...(balance === null ? {} : { balance }) };
		});
}

/** What the interface's form holds: the text typed, before the schema parses it. */
export type SnapshotFormInput = z.input<ReturnType<typeof createSnapshotSchema>>;
