import { z } from "zod";

import { SURE_PERIODS } from "../../domain/balances/sure-periods.ts";

/** `get_accounts`: today's balances, and with `include_balance_series` their history. */
export const getAccountsInput = z.strictObject({
	include_balance_series: z
		.boolean()
		.default(false)
		.describe(
			"Include a historical balance series per account, false by default: pass true only when the owner asks about balance history.",
		),
	// Sure reads an unknown key as its default rather than refusing it.
	series_period: z
		.enum(SURE_PERIODS)
		.catch("last_365_days")
		.default("last_365_days")
		.describe("Period for the balance series, last_365_days by default."),
});
