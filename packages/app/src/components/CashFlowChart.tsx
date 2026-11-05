import { Cell, Pie, PieChart } from "recharts";

/** One segment of the ring: a category's share of the side, in its colour. */
export type CashFlowSegment = { key: string; value: number; fill: string };

/** Sure's `donut-chart` dims every other segment while one is hovered. */
const DIMMED_OPACITY = 0.3;

/**
 * The ring of the dashboard's « Sorties » and of a budget's donut, apart so
 * that recharts loads with them only, never with the shell. With
 * `onHighlight`, hovering a segment names it, and `highlighted` dims the
 * others, as a row hovered beside the ring does.
 */
export function CashFlowChart({
	segments,
	size,
	thickness = 5,
	highlighted = null,
	onHighlight,
	onSelect,
}: {
	segments: CashFlowSegment[];
	size: number;
	thickness?: number;
	highlighted?: string | null;
	onHighlight?: (key: string | null) => void;
	/** A segment clicked, as Sure's `enable-click`: its key. */
	onSelect?: (key: string) => void;
}) {
	return (
		<PieChart width={size} height={size} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
			<Pie
				data={segments}
				dataKey="value"
				nameKey="key"
				innerRadius={size / 2 - 1 - thickness}
				outerRadius={size / 2 - 1}
				startAngle={90}
				endAngle={-270}
				stroke="none"
				rootTabIndex={-1}
				isAnimationActive={false}
				{...(onSelect === undefined
					? {}
					: {
							onClick: (_: unknown, index: number) => {
								const key = segments[index]?.key;

								if (key !== undefined) {
									onSelect(key);
								}
							},
							style: { cursor: "pointer" },
						})}
				{...(onHighlight === undefined
					? {}
					: {
							onMouseEnter: (_: unknown, index: number) =>
								onHighlight(segments[index]?.key ?? null),
							onMouseLeave: () => onHighlight(null),
						})}
			>
				{segments.map((segment) => (
					<Cell
						key={segment.key}
						fill={segment.fill}
						fillOpacity={highlighted === null || highlighted === segment.key ? 1 : DIMMED_OPACITY}
					/>
				))}
			</Pie>
		</PieChart>
	);
}
