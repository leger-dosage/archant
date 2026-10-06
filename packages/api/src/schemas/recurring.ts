import { z } from "zod";

import { RECURRING_STATUSES } from "@archant/data/schema/recurring-transactions";

import { editBodySchema } from "./bills.ts";

/** « Ajouter aux récurrences »: the transaction the pattern starts from. */
export const addRecurringSchema = z.object({ entryId: z.string().min(1) });

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
 * Which series an assistant asks for: `current` is suggested or active, `all`
 * every status « Récurrents » lists, ended ones never.
 */
export const RECURRING_VIEWS = ["current", "inactive", "all"] as const;

export type RecurringView = (typeof RECURRING_VIEWS)[number];
