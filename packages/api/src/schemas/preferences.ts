import { z } from "zod";

import { ACCOUNT_ORDERS } from "@archant/data/account-orders";

/**
 * « Réglages › Préférences »: the order is one of Sure's, else
 * `invalid_value`, as Sure's `inclusion` validation refuses it. Each field
 * is optional because each control saves on its own, as Sure's
 * `auto-submit-form` sends one field.
 */
export const preferencesSchema = z.object({
	defaultAccountOrder: z.enum(ACCOUNT_ORDERS).optional(),
	showSplitGrouped: z.boolean().optional(),
});

export type PreferencesInput = z.infer<typeof preferencesSchema>;
