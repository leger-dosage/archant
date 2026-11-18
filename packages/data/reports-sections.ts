// Apart from the `users` table, so the interface reads the sections without
// bundling Drizzle.

/**
 * The reports page's sortable sections, in the order Sure's
 * `build_reports_sections` lists them: the order a section a stored order
 * leaves out is appended in.
 */
export const REPORTS_SECTIONS = [
	"net_worth",
	"trends_insights",
	"investment_performance",
	"investment_flows",
	"transactions_breakdown",
	"biggest_expenses",
] as const;

export const BIGGEST_EXPENSES_LIMITS = [5, 10, 25] as const;
export type BiggestExpensesLimit = (typeof BIGGEST_EXPENSES_LIMITS)[number];
export const DEFAULT_BIGGEST_EXPENSES_LIMIT: BiggestExpensesLimit = 10;

export type ReportsSection = (typeof REPORTS_SECTIONS)[number];

/**
 * The order a user who never moved a section sees: Sure's
 * `default_reports_section_order`, then the sections `build_reports_sections` appends.
 */
export const DEFAULT_REPORTS_ORDER: readonly ReportsSection[] = [
	"trends_insights",
	"transactions_breakdown",
];

/**
 * What `users.reports_layout` holds, matching Sure's report preferences.
 * Every field is optional: a
 * user who never arranged the page has nothing stored, and a stored key the
 * code no longer knows is dropped on read.
 */
export type StoredReportsLayout = {
	sectionOrder?: string[];
	collapsedSections?: Record<string, boolean>;
	biggestExpensesLimit?: BiggestExpensesLimit;
};
