import { z } from "zod";

import { MAX_TAG_FILTER } from "../transactions.ts";

/**
 * `get_holdings`: Sure's `page`, required as Sure's, and its `accounts` and
 * `securities` filters, beside `account_ids`. Sure's page is 50 rows, with no
 * `page_size`.
 */
export const holdingsInput = z.strictObject({
	page: z.number().int().min(1).describe("Page number; 50 holdings a page."),
	accounts: z
		.array(z.string().min(1))
		.min(1)
		.max(MAX_TAG_FILTER)
		.optional()
		.describe(
			"Exact names of investment accounts, as get_accounts gives them; any of them. A name no active investment account holds matches nothing.",
		),
	account_ids: z
		.array(z.string().min(1))
		.min(1)
		.max(MAX_TAG_FILTER)
		.optional()
		.describe("Investment account ids from get_accounts; any of them. With accounts, both narrow."),
	securities: z
		.array(z.string().trim().min(1))
		.min(1)
		.max(MAX_TAG_FILTER)
		.optional()
		.describe(
			'Ticker symbols such as "AI.PA", case aside; any of them. A security without a ticker, such as a fund typed by hand, matches none.',
		),
});
