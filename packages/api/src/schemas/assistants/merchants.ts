import { z } from "zod";

import { merchantSchema } from "../merchants.ts";
import { clampedPageFields, merchantId } from "./fields.ts";

/** `get_merchants`: a page of the list, narrowed by Sure's `search`. */
export const merchantsInput = z.strictObject({
	...clampedPageFields,
	search: z
		.string()
		.trim()
		.max(200)
		.optional()
		.describe("Case-insensitive substring filter on merchant name."),
});

export const createMerchantInput = merchantSchema.strict();

export const renameMerchantInput = z.strictObject({
	merchant_id: merchantId,
	...merchantSchema.shape,
});
