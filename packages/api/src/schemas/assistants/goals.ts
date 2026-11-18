import { z } from "zod";

import { requiredLoose, sureAmount } from "./fields.ts";

/**
 * Sure's goal inputs. Keep the loose values so the tool can report a missing
 * or invalid target in Sure's validation order.
 */
export const createGoalInput = z.strictObject({
	name: requiredLoose(z.string()).describe("Short goal name, e.g. 'Vacation in Italy'."),
	target_amount: requiredLoose(sureAmount).describe(
		"Total amount to save, in the linked accounts' currency, a number or a decimal string.",
	),
	target_date: z
		.string()
		.nullable()
		.optional()
		.describe("Optional ISO 8601 date (YYYY-MM-DD) for when the user wants to reach the target."),
	// Sure's `Array(value)`: none is an empty list, one name a list of one.
	linked_account_names: z
		.preprocess(
			(value) =>
				value === undefined || value === null ? [] : typeof value === "string" ? [value] : value,
			z.array(z.string()),
		)
		.describe(
			"Names of the household's active depository accounts to link, exactly as get_accounts gives them, case included, all in one currency. Must contain at least one.",
		),
	earmarks: z
		.record(z.string(), sureAmount)
		.optional()
		.describe(
			'Optional map of account name to the amount to reserve from that account, e.g. {"Livret A": 2000}. Required for an account already claimed in full by another goal: the available accounts list gives that flag and the balance less existing fixed earmarks. Accounts left out of this map reserve what remains after fixed earmarks.',
		),
	notes: z.string().nullable().optional().describe("Optional freeform notes."),
});
