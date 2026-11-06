import type { ReportsPageData } from "@/hooks/useReportsPage";
import type { TooltipContentProps } from "recharts";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { toMinorUnits } from "@archant/data/money";

import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { formatCompactMoney } from "@/lib/balance-change";
import { formatMoney } from "@/lib/format-money";
import { shortMonth } from "@/lib/reports";

type Point = ReportsPageData["netWorth"]["series"][number];

/** Sure's chart colours: net worth in the brand colour, assets green, liabilities red. */
const COLOURS = {
	netWorth: "var(--primary)",
	assets: "var(--trend-up)",
	liabilities: "var(--destructive)",
} as const;

function NetWorthTooltip({
	active,
	label,
	points,
	currency,
	labels,
}: {
	active: TooltipContentProps["active"] | undefined;
	label: TooltipContentProps["label"] | undefined;
	points: readonly Point[];
	currency: string;
	labels: Record<keyof typeof COLOURS, string>;
}) {
	const point = points.find((each) => each.date === label);

	if (!(active ?? false) || point === undefined) {
		return null;
	}

	return (
		<div className="flex min-w-52 flex-col gap-1 rounded-lg border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md">
			<span className="text-muted-foreground">{shortMonth(point.date)}</span>
			{(["netWorth", "assets", "liabilities"] as const).map((key) => (
				<div key={key} className="flex items-center gap-2">
					<span
						aria-hidden="true"
						className="inline-block size-2 rounded-full"
						style={{ backgroundColor: COLOURS[key] }}
					/>
					<span className="text-muted-foreground">{labels[key]}</span>
					<span className="ml-auto font-medium tabular-nums">
						{formatMoney({ amount: point[key], currency })}
					</span>
				</div>
			))}
		</div>
	);
}

/**
 * Sure's `reportsNetWorthChart`: the period's net worth month by month, with
 * its assets and liabilities. Apart so that recharts loads with the section only.
 */
export function ReportsNetWorthChart({
	points,
	currency,
	labels,
}: {
	points: readonly Point[];
	currency: string;
	labels: Record<keyof typeof COLOURS, string>;
}) {
	return (
		<ChartContainer config={{}} className="aspect-auto h-72 w-full">
			<LineChart data={[...points]} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
				<CartesianGrid vertical={false} strokeDasharray="3 3" />
				<XAxis
					dataKey="date"
					tickLine={false}
					axisLine={false}
					tickFormatter={(date: string) => shortMonth(date)}
					className="text-xs"
				/>
				<YAxis
					orientation="right"
					tickCount={4}
					tickLine={false}
					axisLine={false}
					width={56}
					tickFormatter={(amount: number) =>
						formatCompactMoney(toMinorUnits(Math.round(amount)), currency)
					}
				/>
				<ChartTooltip
					cursor={{ stroke: "var(--border)", strokeDasharray: "4 4" }}
					isAnimationActive={false}
					content={({ active, label }) => (
						<NetWorthTooltip
							active={active}
							label={label}
							points={points}
							currency={currency}
							labels={labels}
						/>
					)}
				/>
				{(["assets", "liabilities", "netWorth"] as const).map((key) => (
					<Line
						key={key}
						dataKey={key}
						type="monotone"
						stroke={COLOURS[key]}
						strokeWidth={key === "netWorth" ? 2 : 1.5}
						dot={false}
						isAnimationActive={false}
					/>
				))}
			</LineChart>
		</ChartContainer>
	);
}
