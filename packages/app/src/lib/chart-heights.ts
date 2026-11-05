/**
 * A balance chart's height, and its table's: 256 px on an account's page, as
 * Sure's `h-64`, and on the dashboard one of Sure's `DASHBOARD_HEIGHT_PRESETS`,
 * 208 px for `compact`, 288 px for `auto` and 416 px for `tall`. Apart from
 * the chart, so the placeholder shown while recharts loads takes the same room.
 */
export const CHART_HEIGHTS = { 208: "h-52", 256: "h-64", 288: "h-72", 416: "h-104" } as const;

export type ChartHeight = keyof typeof CHART_HEIGHTS;

export const DEFAULT_CHART_HEIGHT: ChartHeight = 256;

/** The dashboard's chart height outside a widget, Sure's `var(--dash-widget-h, 13rem)`. */
export const DASHBOARD_FALLBACK_HEIGHT: ChartHeight = 208;
