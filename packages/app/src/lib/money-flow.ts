/**
 * Sure's `bar-chart` and `spending-chart` colours: income and the month
 * shown in its success green, expenses and the previous month in its
 * `gray-400`. Apart from the charts, so the legends need no recharts.
 */
export const FLOW_COLOURS = { income: "var(--money-income)", muted: "#9e9e9e" } as const;

/** Sure's `LABEL_GAP_PX`: the least room between two month labels. */
const LABEL_GAP_PX = 8;

export type AxisLabels = "full" | "short" | "alternate";

/**
 * Sure's `_fitAxisLabels`: the full labels when the widest fits its band,
 * else the short month, else every other tick, keeping the picked month's
 * parity so it is never the one dropped.
 */
export function axisLabelsFit(
	full: readonly number[],
	short: readonly number[],
	step: number,
): AxisLabels {
	const fits = (widths: readonly number[]) => Math.max(0, ...widths) <= step - LABEL_GAP_PX;

	return fits(full) ? "full" : fits(short) ? "short" : "alternate";
}

/** Under `alternate`, whether the tick at `index` shows: the picked month's parity. */
export const showsAlternateTick = (index: number, highlighted: number) =>
	index % 2 === (highlighted >= 0 ? highlighted % 2 : 0);
