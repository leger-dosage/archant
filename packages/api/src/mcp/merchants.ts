import { z } from "zod";

import { createMerchantInput, merchantsInput, renameMerchantInput } from "../schemas/assistants.ts";
import { createMerchant, listMerchants, renameMerchant } from "../services/merchants.ts";
import { BANK_TEXT, CREATES, READ_ONLY, REPLACES, defineTool, pageOf, pageOutput } from "./tool.ts";

const merchant = z.object({
	id: z.string(),
	name: z.string(),
	transaction_count: z.number().int(),
});

export const getMerchants = defineTool({
	name: "get_merchants",
	title: "Merchants",
	description: `The merchants, sorted by name, a page at a time as Sure's get_merchants, each with how many transactions it holds: the id update_transaction's merchant_id takes, and the exact name get_transactions' merchants filter takes. Pass search to narrow by name rather than paging through them all. ${BANK_TEXT}`,
	scope: "archant:read",
	annotations: READ_ONLY,
	input: merchantsInput,
	output: z.object({ merchants: z.array(merchant), ...pageOutput }),
	run: async (deps, { page, page_size: pageSize, search }) => {
		const folded = search?.toLocaleLowerCase("fr");
		const listed = (await listMerchants(deps)).filter(
			({ name }) => folded === undefined || name.toLocaleLowerCase("fr").includes(folded),
		);
		const { items, ...fields } = pageOf(listed, page, pageSize);

		return {
			result: {
				merchants: items.map(({ id, name, transactionCount }) => ({
					id,
					name,
					transaction_count: transactionCount,
				})),
				...fields,
			},
			changedRows: 0,
		};
	},
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
	run: async (deps, { merchant_id: merchantId, name }) => {
		const { id, name: renamed } = await renameMerchant(deps, merchantId, { name });

		return { result: { merchant: { id, name: renamed } }, changedRows: 1 };
	},
});
