import { z } from "zod";

/** A calendar month, `YYYY-MM`. Shared with the dashboard's `?month=` search param. */
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u);

export const cashFlowQuerySchema = z.object({
	month: monthSchema,
});
