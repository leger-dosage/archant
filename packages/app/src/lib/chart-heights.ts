/**
 * A balance chart's height, and its table's: 208 px on the dashboard and 256 px
 * on an account's page, as Sure's `h-52` and `h-64`. Apart from the chart, so
 * the placeholder shown while recharts loads takes the same room.
 */
export const CHART_HEIGHTS = { 208: "h-52", 256: "h-64" } as const;

export type ChartHeight = keyof typeof CHART_HEIGHTS;

export const DEFAULT_CHART_HEIGHT: ChartHeight = 256;
