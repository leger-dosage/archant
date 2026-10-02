import { z } from "zod";

import { CLASSIFICATIONS } from "@archant/data/account-types";
import { toDecimalString } from "@archant/data/money";

import { noToolInput } from "../schemas/assistants.ts";
import { listAccounts } from "../services/accounts.ts";
import { BANK_TEXT, READ_ONLY, defineTool } from "./tool.ts";

const account = z.object({
	id: z.string(),
	name: z.string(),
	type: z.string(),
	subtype: z.string().nullable(),
	classification: z.enum(CLASSIFICATIONS),
	currency: z.string(),
	balance: z
		.string()
		.describe("Today's balance as a decimal string in the account's currency, such as \"-12.50\"."),
	active: z.boolean(),
	excludedFromReports: z.boolean(),
});

export const getAccounts = defineTool({
	name: "get_accounts",
	title: "Accounts",
	description: `Every account with today's balance, assets then liabilities, inactive ones included. ${BANK_TEXT}`,
	scope: "archant:read",
	annotations: READ_ONLY,
	input: noToolInput,
	output: z.object({ accounts: z.array(account) }),
	run: async (deps) => {
		const { groups } = await listAccounts(deps);

		return {
			result: {
				accounts: groups.flatMap((group) =>
					group.accounts.map((summary) => ({
						id: summary.id,
						name: summary.name,
						type: summary.type,
						subtype: summary.subtype,
						classification: group.classification,
						currency: summary.currency,
						balance: toDecimalString({ amount: summary.balance, currency: summary.currency }),
						active: summary.active,
						excludedFromReports: summary.excludedFromReports,
					})),
				),
			},
			changedRows: 0,
		};
	},
});
