import { z } from "zod";

import { createMerchantInput, noToolInput, renameMerchantInput } from "../schemas/assistants.ts";
import { createMerchant, listMerchants, renameMerchant } from "../services/merchants.ts";
import { BANK_TEXT, CREATES, READ_ONLY, REPLACES, defineTool } from "./tool.ts";

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

export const renameMerchantTool = defineTool({
	name: "rename_merchant",
	title: "Rename a merchant",
	description:
		"Renames a merchant as « Réglages » does; every transaction it holds shows the new name. A name another merchant holds, case aside, answers VALIDATION_ERROR with name_taken.",
	scope: "archant:write",
	annotations: REPLACES,
	input: renameMerchantInput,
	output: z.object({ merchant: z.object({ id: z.string(), name: z.string() }) }),
	run: async (deps, { merchantId, name }) => {
		const { id, name: renamed } = await renameMerchant(deps, merchantId, { name });

		return { result: { merchant: { id, name: renamed } }, changedRows: 1 };
	},
});
