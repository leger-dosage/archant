import { z } from "zod";

/**
 * The chart periods, in the order the segmented control shows them. Shared by
 * the API query and the interface's search param, so a period the page offers
 * is one the API accepts.
 */
export const BALANCE_PERIODS = ["1M", "3M", "6M", "1Y", "all"] as const;

export type BalancePeriod = (typeof BALANCE_PERIODS)[number];

/** Sure's default, `last_30_days`, rounded to a calendar month. */
export const DEFAULT_BALANCE_PERIOD: BalancePeriod = "1M";

export const balanceQuerySchema = z.object({
	period: z.enum(BALANCE_PERIODS).default(DEFAULT_BALANCE_PERIOD),
});
