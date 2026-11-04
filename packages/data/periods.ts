// Apart from the `users` table, so the interface reads the periods without
// bundling Drizzle.

/**
 * Sure's `Period::PERIODS` keys, in its order: the dashboard and account
 * charts' periods, and the one each user saves as `default_period`. A new key
 * is a check rebuilt, no data migration.
 */
export const SURE_PERIODS = [
	"last_day",
	"current_week",
	"last_7_days",
	"current_month",
	"last_month",
	"last_30_days",
	"last_90_days",
	"current_year",
	"last_365_days",
	"last_5_years",
	"last_10_years",
	"all_time",
] as const;

export type SurePeriod = (typeof SURE_PERIODS)[number];

/** Sure's `users.default_period` default, and `Periodable`'s fallback for an unknown key. */
export const DEFAULT_PERIOD: SurePeriod = "last_30_days";

/**
 * Sure's `Loan::PayoffChart::WINDOW_KEYS`, in its order: the periods a loan's
 * chart offers. Any other key shows the loan's whole life.
 */
export const LOAN_WINDOW_PERIODS = [
	"current_month",
	"last_90_days",
	"current_year",
	"last_365_days",
	"last_5_years",
	"last_10_years",
	"all_time",
] as const satisfies readonly SurePeriod[];

/** A real calendar day, so « 2026-02-30 » is no date, as Ruby's `Date.parse` refuses it. */
function isCalendarDay(date: string): boolean {
	const parsed = new Date(`${date}T00:00:00Z`);

	return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

/**
 * Sure's `Period.custom` validation: two calendar days, the first not after
 * the second. Shared by the API and the interface, so both read the same
 * range as custom and fall back from the same others.
 */
export function isCustomRange(startDate: string, endDate: string): boolean {
	return isCalendarDay(startDate) && isCalendarDay(endDate) && startDate <= endDate;
}
