import { z } from "zod";

import { createMerchantInput, merchantsInput, renameMerchantInput } from "../schemas/assistants.ts";
import { createMerchant, listMerchants, renameMerchant } from "../services/merchants.ts";
import {
	BANK_TEXT,
	CREATES,
	READ_ONLY,
	REPLACES,
	defineTool,
	pageOf,
	pageOutput,
	validated,
} from "./tool.ts";

const merchant = z.object({
	id: z.string(),
	name: z.string(),
	source: z
		.literal("family")
		.describe("Always family: every merchant here is the household's own, none a provider's."),
});

export const getMerchants = defineTool({
	name: "get_merchants",
	title: "Merchants",
	description: `Returns the merchants, sorted alphabetically, a page at a time as Sure's get_merchants. Each entry includes the id update_transaction's merchant_id takes and the exact name get_transactions' merchants filter takes. Pass search to filter by name instead of paging through everything. ${BANK_TEXT}`,
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
				merchants: items.map(({ id, name }) => ({ id, name, source: "family" as const })),
				...fields,
			},
			changedRows: 0,
		};
	},
});

/** What a write answers, as Sure's `create_tag`: the merchant and a sentence. */
const written = z.object({ success: z.literal(true), merchant, message: z.string() });

function writtenOf({ id, name }: { id: string; name: string }, verb: "created" | "updated") {
	return {
		success: true as const,
		merchant: { id, name, source: "family" as const },
		message: `Merchant '${name}' ${verb}.`,
	};
}

export const createMerchantTool = defineTool({
	name: "create_merchant",
	title: "Create a merchant",
	description:
		"Creates a merchant as Archant's merchant picker does, answering as Sure's create_tag: { success, merchant, message }, its id for a rule's action or condition. Merchant names must be unique, case aside: a taken one answers validation_failed; use that merchant's id from get_merchants instead.",
	scope: "archant:write",
	annotations: CREATES,
	input: createMerchantInput,
	output: written,
	run: async (deps, input) => ({
		result: writtenOf(await validated(async () => createMerchant(deps, input)), "created"),
		changedRows: 1,
	}),
});

export const renameMerchantTool = defineTool({
	name: "rename_merchant",
	title: "Rename a merchant",
	description:
		"Renames a merchant as « Réglages » does, answering as Sure's update_tag: { success, merchant, message }; every transaction it holds shows the new name. A name another merchant holds, case aside, answers validation_failed.",
	scope: "archant:write",
	annotations: REPLACES,
	input: renameMerchantInput,
	output: written,
	run: async (deps, { merchant_id: merchantId, name }) => ({
		result: writtenOf(
			await validated(async () => renameMerchant(deps, merchantId, { name })),
			"updated",
		),
		changedRows: 1,
	}),
});
