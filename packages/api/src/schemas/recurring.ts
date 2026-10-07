import { z } from "zod";

import { RECURRING_STATUSES } from "@archant/data/schema/recurring-transactions";

import { editBodySchema } from "./bills.ts";

/** « Ajouter aux récurrences »: the transaction the pattern starts from. */
export const addRecurringSchema = z.object({ entryId: z.string().min(1) });

/**
 * « Ajouter un paiement »: a transaction, its amount optional, or else an
 * amount and a date with no transaction, as Sure's `recurring_allocations`.
 * The amount is decimal text the service reads in the occurrence's currency.
 */
export const addPaymentSchema = z.object({
	entryId: z.string().min(1).optional(),
	amount: z.string().optional(),
	paidOn: z.iso.date().optional(),
});

export type AddPaymentInput = z.output<typeof addPaymentSchema>;

/** « Marquer comme payée », today unless the owner names the day. */
export const markPaidSchema = z.object({ paidOn: z.iso.date().optional() });

/**
 * `PATCH /api/recurring/occurrences/:id`: « Reporter » to a date, or
 * « Modifier le montant » as decimal text, `null` clearing either, one at a
 * time as Sure's `snooze` and `override_amount`.
 */
export const occurrencePatchSchema = z.union([
	z.strictObject({ snoozedUntil: z.iso.date().nullable() }),
	z.strictObject({ expectedAmount: z.string().nullable() }),
]);

export type OccurrencePatch = z.output<typeof occurrencePatchSchema>;

/**
 * `PATCH /api/recurring/:id`: a status alone, which the service refuses for a
 * move it cannot make, `suggested` included; or else the edit dialog's fields.
 */
export const recurringPatchSchema = editBodySchema
	.extend({ status: z.enum(RECURRING_STATUSES).optional() })
	.superRefine((body, context) => {
		const fields = Object.entries(body).filter(([, value]) => value !== undefined);

		// Nothing to do, or a status beside edits it would drop.
		if (fields.length === 0) {
			context.addIssue({ code: "custom", message: "invalid_value" });
		} else if (body.status !== undefined && fields.length > 1) {
			context.addIssue({ code: "custom", path: ["status"], message: "invalid_value" });
		}
	});

export type RecurringPatch = z.output<typeof recurringPatchSchema>;

/**
 * Which series an assistant asks for, as Sure's `get_recurring_transactions`:
 * `active` the ones followed, `all` every status « Récurrents » lists, the
 * suggestions included, ended ones never.
 */
export const RECURRING_VIEWS = ["active", "inactive", "all"] as const;

export type RecurringView = (typeof RECURRING_VIEWS)[number];
