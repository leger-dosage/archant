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

/** A name alone: Sure has no merchant write tool whose colour or website these would follow. */
const merchantName = merchantSchema.pick({ name: true });

export const createMerchantInput = merchantName.strict();

export const renameMerchantInput = z.strictObject({
	merchant_id: merchantId,
	...merchantName.shape,
});
