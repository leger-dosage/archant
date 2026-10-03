import { z } from "zod";

import { RECURRING_STATUSES } from "@archant/data/schema/recurring-transactions";

/** « Ajouter aux récurrences »: the transaction the pattern starts from. */
export const addRecurringSchema = z.object({ entryId: z.string().min(1) });

/** The service refuses a move the status cannot make, `detected` included. */
export const recurringStatusSchema = z.object({ status: z.enum(RECURRING_STATUSES) });

/**
 * Which series an assistant asks for: `current` is detected or confirmed,
 * `all` every status « Récurrents » lists, dismissed ones never.
 */
export const RECURRING_VIEWS = ["current", "inactive", "all"] as const;

export type RecurringView = (typeof RECURRING_VIEWS)[number];
