import { z } from "zod";

/** « Réglages › Placements »' switch. */
export const priceSettingsSchema = z.object({ enabled: z.boolean() });

/**
 * A search for a security, as typed: a ticker, an ISIN or a name. Capped
 * well above any of them, since it travels to the provider as is.
 */
export const securitySearchSchema = z.object({ q: z.string().trim().min(1).max(64) });
