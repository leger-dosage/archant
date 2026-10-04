import { z } from "zod";

import { readMicros } from "@archant/data/micros";

/** « Réglages › Placements »' switch. */
export const priceSettingsSchema = z.object({ enabled: z.boolean() });

/**
 * A search for a security, as typed: a ticker, an ISIN or a name. Capped
 * well above any of them, since it travels to the provider as is.
 */
export const securitySearchSchema = z.object({ q: z.string().trim().min(1).max(64) });

// The text as typed, so the typed client knows the body; the service parses it.
export const typedPriceBodySchema = z.object({ date: z.string(), price: z.string() });

export type TypedPriceInput = z.input<typeof typedPriceBodySchema>;

/**
 * « Saisir un cours »: a day's price typed by hand, per unit in the
 * security's currency, above zero as every stored price is, on a day not
 * after `today`. Built per day and shared with the position sheet's form.
 */
export function typedPriceSchema(today: string) {
	return z.object({
		// Piped, so a date that does not parse is not also called a future one.
		date: z.iso
			.date()
			.pipe(z.string().refine((date) => date <= today, { message: "date_in_future" })),
		price: z.string().transform((text, context) => {
			const value = readMicros(text);

			if (value === null || value <= 0) {
				context.addIssue({ code: "custom", message: "invalid_price" });

				return z.NEVER;
			}

			return value;
		}),
	});
}
