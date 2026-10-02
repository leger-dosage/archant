import { z } from "zod";

import { noToolInput } from "../schemas/assistants.ts";
import { listMerchants } from "../services/merchants.ts";
import { BANK_TEXT, READ_ONLY, defineTool } from "./tool.ts";

const merchant = z.object({ id: z.string(), name: z.string(), transactionCount: z.number().int() });

export const getMerchants = defineTool({
	name: "get_merchants",
	title: "Merchants",
	description: `Every merchant, with how many transactions it holds. ${BANK_TEXT}`,
	scope: "archant:read",
	annotations: READ_ONLY,
	input: noToolInput,
	output: z.object({ merchants: z.array(merchant) }),
	run: async (deps) => ({ result: { merchants: await listMerchants(deps) }, changedRows: 0 }),
});
