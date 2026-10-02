import { z } from "zod";

import { createMerchantInput, noToolInput } from "../schemas/assistants.ts";
import { createMerchant, listMerchants } from "../services/merchants.ts";
import { BANK_TEXT, CREATES, READ_ONLY, defineTool } from "./tool.ts";

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

export const createMerchantTool = defineTool({
	name: "create_merchant",
	title: "Create a merchant",
	description:
		"Creates a merchant as Archant's merchant picker does and returns its id for a rule's action or condition. A name already taken answers VALIDATION_ERROR with name_taken: use that merchant's id from get_merchants instead.",
	scope: "archant:write",
	annotations: CREATES,
	input: createMerchantInput,
	output: z.object({ merchant: z.object({ id: z.string(), name: z.string() }) }),
	run: async (deps, input) => {
		const { id, name } = await createMerchant(deps, input);

		return { result: { merchant: { id, name } }, changedRows: 1 };
	},
});
