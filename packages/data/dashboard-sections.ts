// Apart from the `users` table, so the interface reads the widgets without
// bundling Drizzle.

/**
 * The dashboard's widgets, in Sure's default order, Sure's `dashboard_section_builders` keys but
 * `insights_feed`, which Archant has no insights for, plus `goals`, which
 * Sure keeps on its Plan page.
 */
export const DASHBOARD_SECTIONS = [
	"cashflow_sankey",
	"outflows_donut",
	"net_worth_chart",
	"balance_sheet",
	"money_flow",
	"spending_trend",
	"investment_summary",
	"goals",
] as const;

export type DashboardSection = (typeof DASHBOARD_SECTIONS)[number];

/**
 * The order a user who never moved a widget sees: Sure's
 * `default_dashboard_section_order`, then the builder keys it does not list,
 * as its `ordered_dashboard_section_keys` appends them, `goals` last.
 */
export const DEFAULT_DASHBOARD_ORDER: readonly DashboardSection[] = [...DASHBOARD_SECTIONS];

export const DASHBOARD_COL_SPANS = ["single", "full"] as const;

export type DashboardColSpan = (typeof DASHBOARD_COL_SPANS)[number];

/** Sure's height presets, in its order, the grow widgets' choices. */
export const DASHBOARD_HEIGHT_PRESET_KEYS = ["compact", "auto", "tall"] as const;

export type DashboardHeightPreset = (typeof DASHBOARD_HEIGHT_PRESET_KEYS)[number];

/** Sure's `DASHBOARD_HEIGHT_PRESETS`, in pixels. */
export const DASHBOARD_HEIGHT_PRESETS = {
	compact: 208,
	auto: 288,
	tall: 416,
} as const satisfies Record<DashboardHeightPreset, number>;

/** Sure's `DEFAULT_HEIGHT_PRESET`. */
export const DEFAULT_HEIGHT_PRESET: DashboardHeightPreset = "auto";

/**
 * Sure's `DASHBOARD_SECTION_LAYOUTS`: the width a widget starts at, whether
 * its chart takes a height preset, and whether its width may change. The
 * donut and the goals card keep their width; `goals`, Archant's own, reads
 * as Sure's other content-sized cards.
 */
export const DASHBOARD_SECTION_LAYOUTS: Record<
	DashboardSection,
	{ colSpan: DashboardColSpan; grow: boolean; widthToggle: boolean }
> = {
	cashflow_sankey: { colSpan: "full", grow: false, widthToggle: true },
	outflows_donut: { colSpan: "single", grow: false, widthToggle: false },
	net_worth_chart: { colSpan: "single", grow: true, widthToggle: true },
	balance_sheet: { colSpan: "single", grow: false, widthToggle: true },
	money_flow: { colSpan: "single", grow: false, widthToggle: true },
	spending_trend: { colSpan: "single", grow: true, widthToggle: true },
	investment_summary: { colSpan: "single", grow: false, widthToggle: true },
	goals: { colSpan: "single", grow: false, widthToggle: false },
};

/** One value per widget, every key named, so a widget added later cannot be forgotten. */
export function perSection<Value>(
	value: (key: DashboardSection) => Value,
): Record<DashboardSection, Value> {
	return {
		cashflow_sankey: value("cashflow_sankey"),
		outflows_donut: value("outflows_donut"),
		net_worth_chart: value("net_worth_chart"),
		balance_sheet: value("balance_sheet"),
		money_flow: value("money_flow"),
		spending_trend: value("spending_trend"),
		investment_summary: value("investment_summary"),
		goals: value("goals"),
	};
}

/** One widget's saved size, Sure's `dashboard_section_layout` entry: either half may be absent. */
export type DashboardSectionSize = { height?: DashboardHeightPreset; colSpan?: DashboardColSpan };

/**
 * What `users.dashboard_layout` holds, Sure's four dashboard keys of
 * `users.preferences`. Every key is optional: a user who never arranged the
 * dashboard has nothing stored, and a stored key the code no longer knows is
 * dropped on read.
 */
export type StoredDashboardLayout = {
	sectionOrder?: string[];
	collapsedSections?: Record<string, boolean>;
	hiddenSections?: string[];
	sectionLayout?: Record<string, DashboardSectionSize>;
};
