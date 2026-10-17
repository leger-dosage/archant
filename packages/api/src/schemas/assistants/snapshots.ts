import { z } from "zod";

import { CITATION_MAX_LENGTH, ESTIMATED_PREFIX } from "../../domain/balances/citation.ts";
import { DEFAULT_PAGE_SIZE } from "../transactions.ts";
import { accountId, clampedPageFields, requiredLoose, sureAmount } from "./fields.ts";

/**
 * `get_valuations`: a page of valuations, as Sure's: every active account's
 * unless one is named, between two optional dates. The dates reach `run`
 * loosely typed, which refuses them with Sure's `invalid_date`; the page
 * reads as Sure's `resolved_page`.
 */
export const valuationsInput = z.strictObject({
	account_id: accountId
		.optional()
		.describe(
			"Only valuations for this account UUID (from get_accounts); every active account's without it.",
		),
	start_date: z.string().optional().describe("Only valuations on or after this date, YYYY-MM-DD."),
	end_date: z.string().optional().describe("Only valuations on or before this date, YYYY-MM-DD."),
	page: clampedPageFields.page.describe(
		`${DEFAULT_PAGE_SIZE} valuations a page, most recent first; 1 by default.`,
	),
});

/**
 * `record_valuation`: Sure's parameters. The date, the amount and the source
 * reach `run` loosely typed, which refuses them with Sure's keys in Sure's
 * order; the balance is then recorded through the « Soldes » dialog's checks.
 */
export const recordValuationInput = z.strictObject({
	account_id: accountId,
	date: requiredLoose(z.string()).describe(
		"ISO 8601 date (YYYY-MM-DD) the value applies to; it may be after today, up to a year ahead; on the opening date, it sets the opening balance. For a period-end value, use the last day of the period.",
	),
	amount: requiredLoose(sureAmount).describe(
		"The account's stored balance on that date in its own currency, a number or a decimal string: what an asset holds or is worth, what a liability still owes, both positive; an overdraft is negative.",
	),
	source: requiredLoose(z.string()).describe(
		`Required citation naming the document this value came from, in the grammar: ["${ESTIMATED_PREFIX}"] citation [" (grade: A|B|C)"], ${CITATION_MAX_LENGTH} characters at most, on one line.`,
	),
});
