import { z } from "zod";

import { ACCOUNT_ORDERS } from "@archant/data/account-orders";

/**
 * « Réglages › Préférences »: the order is one of Sure's, else
 * `invalid_value`, as Sure's `inclusion` validation refuses it.
 */
export const preferencesSchema = z.object({ defaultAccountOrder: z.enum(ACCOUNT_ORDERS) });

export type PreferencesInput = z.infer<typeof preferencesSchema>;
