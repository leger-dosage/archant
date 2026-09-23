import { z } from "zod";

/** Matching a transaction with the counterpart the user picked from its candidates. */
export const transferBodySchema = z.object({
	transactionId: z.string().min(1),
	counterpartId: z.string().min(1),
});

export type TransferInput = z.input<typeof transferBodySchema>;
export type TransferRequest = z.output<typeof transferBodySchema>;
