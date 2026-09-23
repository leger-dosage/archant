import { z } from "zod";

import { MERCHANT_NAME_MAX_LENGTH } from "@archant/data/schema/merchants";

// NFC: a pasted « Épicerie » may arrive decomposed, and would otherwise sit
// beside the composed one as a second merchant of the same name.
const merchantName = z
	.string()
	.trim()
	.transform((value) => value.normalize("NFC"))
	.pipe(z.string().min(1).max(MERCHANT_NAME_MAX_LENGTH));

/** Creating and renaming take the same body, so a name one accepts the other does too. */
export const merchantSchema = z.object({ name: merchantName });

export type MerchantInput = z.input<typeof merchantSchema>;
export type MerchantRequest = z.output<typeof merchantSchema>;

export const mergeMerchantSchema = z.object({ targetId: z.string().min(1) });
