import { Pie, PieChart } from "recharts";

/** One segment of the ring: a category's share of the side, in its colour. */
export type CashFlowSegment = { key: string; value: number; fill: string };

/**
 * The ring of `CashFlowSection`'s donut, apart so that recharts loads with the
 * dashboard's cash flow only, never with the shell.
 */
export function CashFlowChart({ segments, size }: { segments: CashFlowSegment[]; size: number }) {
	return (
		<PieChart width={size} height={size} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
			<Pie
				data={segments}
				dataKey="value"
				nameKey="key"
				innerRadius={size / 2 - 6}
				outerRadius={size / 2 - 1}
				startAngle={90}
				endAngle={-270}
				stroke="none"
				rootTabIndex={-1}
				isAnimationActive={false}
			/>
		</PieChart>
	);
}
