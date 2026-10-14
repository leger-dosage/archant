import { z } from "zod";

import { looseBoolean, requiredLoose, sureAmount } from "./fields.ts";

/**
 * `set_opening_balance`: Sure's parameters, loosely typed as Sure reads them:
 * `run` refuses a balance that is no number and a date that is no ISO 8601
 * date with Sure's keys, in Sure's order, and casts `dry_run` as Rails does.
 */
export const setOpeningBalanceInput = z.strictObject({
	account_id: requiredLoose(z.string()).describe("Manual account ID from get_accounts."),
	balance: requiredLoose(z.union([sureAmount, z.boolean()])).describe(
		"Opening balance in the account's currency, a number or a decimal string.",
	),
	date: z
		.string()
		.nullable()
		.optional()
		.describe(
			"Date the opening balance applies from (YYYY-MM-DD), before the account's oldest entry. Omit to keep the current date.",
		),
	dry_run: looseBoolean
		.nullable()
		.optional()
		.describe("Describe the change without making it. Defaults to false."),
});
