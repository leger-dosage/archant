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
] as const;

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
 * What `users.reports_layout` holds, Sure's `reports_section_order` and
 * `reports_collapsed_sections` of `users.preferences`. Both are optional: a
 * user who never arranged the page has nothing stored, and a stored key the
 * code no longer knows is dropped on read.
 */
export type StoredReportsLayout = {
	sectionOrder?: string[];
	collapsedSections?: Record<string, boolean>;
};
