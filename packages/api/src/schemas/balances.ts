import { z } from "zod";

import { DEFAULT_PERIOD, SURE_PERIODS } from "@archant/data/periods";

/**
 * The chart reads' query, as Sure's `Periodable`: one of Sure's keys, an
 * unknown one or an old link's « 1M » read as the default, or a custom range
 * when both dates are given. The dates stay strings here: a range that does
 * not parse falls back to the default in `resolveChartRange`, as Sure's,
 * rather than leaving the key to apply.
 */
export const balanceQuerySchema = z.object({
	period: z.enum(SURE_PERIODS).catch(DEFAULT_PERIOD).default(DEFAULT_PERIOD),
	startDate: z.string().optional().catch(undefined),
	endDate: z.string().optional().catch(undefined),
});
