import { z } from "zod";

/** A calendar month, `YYYY-MM`. Shared with the dashboard's and the budgets' month params. */
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u);

/** Sure's `money_flow_month_param`: a month that does not parse is this month, as none is. */
const pickedMonthSchema = monthSchema.optional().catch(undefined);

export const moneyFlowQuerySchema = z.object({
	month: pickedMonthSchema,
	// A repeated key, a lone one arriving as a string; an unknown id is
	// dropped by the report, as Sure's `money_flow_account_ids_param`.
	accountIds: z
		.union([z.string().transform((id) => [id]), z.array(z.string())])
		.optional()
		.catch(undefined),
});

export const spendingTrendQuerySchema = z.object({
	month: pickedMonthSchema,
});
