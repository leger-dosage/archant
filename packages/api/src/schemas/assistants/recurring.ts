import { z } from "zod";

import { RECURRING_VIEWS } from "../recurring.ts";
import { looseInteger } from "./fields.ts";

/**
 * `get_recurring_transactions`: Sure's filters, read loosely as Sure's: an
 * unknown status reads `active`, and the days as Ruby's `to_i`, held within
 * 1 and 365.
 */
export const recurringInput = z.strictObject({
	status: z
		.enum(RECURRING_VIEWS)
		.catch("active")
		.default("active")
		.describe(
			'"active" by default, followed by the owner; "inactive": paused or retired; "all": every series, the suggestions awaiting the owner and the ended ones included. Any other value reads as "active".',
		),
	upcoming_within_days: looseInteger
		.nullable()
		.optional()
		.catch(undefined)
		.describe(
			"Only include items whose next expected date falls from today to this many days from now, 1 to 365; overdue ones are left out.",
		),
});
