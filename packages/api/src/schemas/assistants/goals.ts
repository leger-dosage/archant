import { z } from "zod";

import { GOAL_KINDS, GOAL_TARGET_MONTHS_MAX } from "@archant/data/goals";

import { requiredLoose, sureAmount } from "./fields.ts";

/**
 * `create_goal`: Sure's parameters, accounts by their exact names, then
 * Archant's reserve. Sure's values reach `run` loosely typed, as Sure reads
 * them, which refuses them with Sure's keys in Sure's order: a target that
 * is not a positive number, an unreadable date ignored, earmarks that are
 * not positive numbers dropped. Archant's own `kind` and `target_months`
 * are checked here, `target_months` a whole number.
 */
export const createGoalInput = z.strictObject({
	name: requiredLoose(z.string()).describe("Short goal name, e.g. 'Vacation in Italy'."),
	target_amount: sureAmount
		.optional()
		.describe(
			"Total amount to save, in the linked accounts' currency, a number or a decimal string. A reserve may give target_months instead.",
		),
	target_date: z
		.string()
		.nullable()
		.optional()
		.describe(
			"Optional ISO 8601 date (YYYY-MM-DD) for when the user wants to reach the target; refused for a reserve.",
		),
	// Sure's `Array(value)`: none is an empty list, one name a list of one.
	linked_account_names: z
		.preprocess(
			(value) =>
				value === undefined || value === null ? [] : typeof value === "string" ? [value] : value,
			z.array(z.string()),
		)
		.describe(
			"Names of the household's active current, savings or investment accounts to link, exactly as get_accounts gives them, case included, all in one currency. Must contain at least one.",
		),
	earmarks: z
		.record(z.string(), sureAmount)
		.optional()
		.describe(
			'Optional map of account name to the amount to reserve from that account, e.g. {"Livret A": 2000}. Required for an account already claimed in full by another goal: the available accounts list says which, and how much room is left. Accounts left out of this map reserve their whole balance.',
		),
	notes: z.string().nullable().optional().describe("Optional freeform notes."),
	kind: z
		.enum(GOAL_KINDS)
		.default("one_off")
		.describe(
			'Archant\'s own: "one_off" saves toward a target, by a date if one is given; "maintained" is a reserve kept full, such as an emergency fund, with no date.',
		),
	target_months: z
		.number()
		.int()
		.optional()
		.describe(
			`Archant's own, a reserve only: its target is that many months of the household's median monthly expenses, 1 to ${GOAL_TARGET_MONTHS_MAX}, followed as they move, instead of target_amount, and only for accounts in the reporting currency.`,
		),
});
