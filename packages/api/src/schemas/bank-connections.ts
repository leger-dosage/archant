import { z } from "zod";

import { BANK_COUNTRIES } from "@archant/data/bank-countries";

export const institutionsQuerySchema = z.object({ country: z.enum(BANK_COUNTRIES) });

/** The bank the user picked; the service reads it again from the provider's list. */
export const startConnectionSchema = z.object({
	country: z.enum(BANK_COUNTRIES),
	institution: z.string().trim().min(1).max(200),
});

export type StartConnectionInput = z.infer<typeof startConnectionSchema>;

/** What the bank put in the return URL, posted by the return page. */
export const completeConnectionSchema = z.object({
	code: z.string().min(1).max(2000),
	state: z.string().min(1).max(200),
});

export type CompleteConnectionInput = z.infer<typeof completeConnectionSchema>;
