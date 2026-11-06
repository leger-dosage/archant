import { z } from "zod";

import { DEFAULT_REPORT_PERIOD_TYPE, REPORT_PERIOD_TYPES } from "@archant/data/report-periods";
import type { ReportsLayoutPatch } from "@archant/data/reports-layout";
import { REPORTS_SECTIONS } from "@archant/data/reports-sections";

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

/**
 * A report day: a date outside 1900 to 2100 is no date, as one that does not
 * parse, since `9999-12-31` would build some 120,000 monthly buckets and a
 * year before 1 would write « -000001 ».
 */
const reportDate = z.iso
	.date()
	.refine((date) => date >= "1900-01-01" && date <= "2100-12-31")
	.optional()
	.catch(undefined);

/**
 * Sure's `setup_report_data` params: an unknown type is `monthly`, and a date
 * that does not parse is the type's default, as `parse_date_param` drops it.
 * No `filter_*` param: Sure's page offers no control for them.
 */
export const reportsPageQuerySchema = z.object({
	periodType: z.enum(REPORT_PERIOD_TYPES).catch(DEFAULT_REPORT_PERIOD_TYPE),
	startDate: reportDate,
	endDate: reportDate,
});

export type ReportsPageQuery = z.infer<typeof reportsPageQuerySchema>;

const reportsSection = z.enum(REPORTS_SECTIONS);

/**
 * One change to the reports page, as Sure's `preferences_params`: an order,
 * or sections collapsed. A key Archant has no section for is refused rather
 * than stored.
 */
export const reportsLayoutSchema = z.strictObject({
	sectionOrder: z
		.array(reportsSection)
		.refine((keys) => new Set(keys).size === keys.length, "duplicate_section")
		.optional(),
	collapsedSections: z.partialRecord(reportsSection, z.boolean()).optional(),
}) satisfies z.ZodType<ReportsLayoutPatch>;

export type ReportsLayoutInput = z.infer<typeof reportsLayoutSchema>;
