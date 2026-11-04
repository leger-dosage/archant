import { z } from "zod";

import { ACCOUNT_ORDERS } from "@archant/data/account-orders";
import { LOCALES } from "@archant/data/locales";
import { SURE_PERIODS } from "@archant/data/periods";

/**
 * « Réglages › Préférences »: the order is one of Sure's, else
 * `invalid_value`, as Sure's `inclusion` validation refuses it. Each field
 * is optional because each control saves on its own, as Sure's
 * `auto-submit-form` sends one field.
 */
export const preferencesSchema = z.object({
	defaultAccountOrder: z.enum(ACCOUNT_ORDERS).optional(),
	// The chart period an administrator last picked, Sure's `default_period`.
	defaultPeriod: z.enum(SURE_PERIODS).optional(),
	showSplitGrouped: z.boolean().optional(),
	// Null goes back to the browser's language, Sure's blank `locale`.
	locale: z.enum(LOCALES).nullable().optional(),
	// The household's, Sure's `families.locale`: an administrator's write, which
	// `viewerReadOnly` already keeps from a viewer.
	householdLocale: z.enum(LOCALES).optional(),
});

export type PreferencesInput = z.infer<typeof preferencesSchema>;

/** Sure's rule prompt form: « Ne plus afficher » ticked or not. */
export const rulePromptDismissalSchema = z.object({ disabled: z.boolean() });
