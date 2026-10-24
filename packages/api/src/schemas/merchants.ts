import { z } from "zod";

import { MERCHANT_NAME_MAX_LENGTH } from "@archant/data/name-limits";

import { categoryColor } from "./categories.ts";

/** Room for any real address; Sure sets no bound, a column needs one. */
export const MERCHANT_WEBSITE_MAX_LENGTH = 255;

// NFC: a pasted « Épicerie » may arrive decomposed, and would otherwise sit
// beside the composed one as a second merchant of the same name.
const merchantName = z
	.string()
	.trim()
	.transform((value) => value.normalize("NFC"))
	.pipe(z.string().min(1).max(MERCHANT_NAME_MAX_LENGTH));

/** Sure's free `website_url`, a blank one cleared. Never fetched nor linked. */
const websiteUrl = z
	.string()
	.trim()
	.max(MERCHANT_WEBSITE_MAX_LENGTH)
	.transform((value) => (value === "" ? null : value))
	.nullable();

/**
 * Creating and editing take the same body, so a name one accepts the other
 * does too. Without a colour, a new merchant draws one of Sure's ten and an
 * edited one keeps its own; without a website, an edited one keeps its own.
 */
export const merchantSchema = z.object({
	name: merchantName,
	color: categoryColor.optional(),
	websiteUrl: websiteUrl.optional(),
});

export type MerchantInput = z.input<typeof merchantSchema>;
export type MerchantRequest = z.output<typeof merchantSchema>;

const merchantId = z.string().min(1);

/** Sure's `perform_merge`: several sources into one target. */
export const mergeMerchantsSchema = z.object({
	targetId: merchantId,
	sourceIds: z.array(merchantId).min(1),
});
