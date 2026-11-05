import type { SpendingTrendData } from "@/hooks/useSpendingTrend";
import type { TooltipContentProps, XAxisTickContentProps } from "recharts";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { toMinorUnits } from "@archant/data/money";

import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { formatCompactMoney } from "@/lib/balance-change";
import { formatMoney } from "@/lib/format-money";
import { intlLocale } from "@/lib/locale";
import { FLOW_COLOURS } from "@/lib/money-flow";
import { cn } from "@/lib/utils";

const dayMonth = new Intl.DateTimeFormat(intlLocale, {
	day: "numeric",
	month: "short",
	timeZone: "UTC",
});

const shortDate = (iso: string) => dayMonth.format(new Date(`${iso}T00:00:00Z`));

/** One axis slot: each month's spending to that day, unsigned, as Sure shows it. */
type Slot = {
	day: number;
	current?: number;
	currentDate?: string;
	previous?: number;
	previousDate?: string;
};

/**
 * The axis is the month shown's days; the current curve stops at today, the
 * previous one runs to its month's end, its extra days folded into the last
 * slot by the API.
 */
function slotsOf(data: SpendingTrendData): Slot[] {
	return Array.from({ length: data.days }, (_, index) => {
		const current = data.current[index];
		const previous = data.previous[index];
		return {
			day: index + 1,
			...(current === undefined
				? {}
				: { current: Math.abs(current.amount), currentDate: current.date }),
			...(previous === undefined
				? {}
				: { previous: Math.abs(previous.amount), previousDate: previous.date }),
		};
	});
}

function SpendingTooltip({
	active,
	label,
	slots,
	currency,
	labels,
}: {
	active: TooltipContentProps["active"] | undefined;
	label: TooltipContentProps["label"] | undefined;
	slots: readonly Slot[];
	currency: string;
	labels: { current: string; previous: string };
}) {
	const slot = typeof label === "number" ? slots[label - 1] : undefined;

	if (!(active ?? false) || slot === undefined) {
		return null;
	}

	const row = (name: string, colour: string, amount: number | undefined, date?: string) =>
		amount === undefined ? null : (
			<div className="flex items-center gap-2">
				<span
					aria-hidden="true"
					className="inline-block size-2 rounded-full"
					style={{ backgroundColor: colour }}
				/>
				<span className="text-muted-foreground">
					{name}
					{date === undefined ? "" : ` · ${shortDate(date)}`}
				</span>
				<span className="ml-auto font-medium tabular-nums">
					{formatMoney({ amount: toMinorUnits(amount), currency })}
				</span>
			</div>
		);

	return (
		<div className="flex min-w-52 flex-col gap-1 rounded-lg border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md">
			{row(labels.current, FLOW_COLOURS.income, slot.current, slot.currentDate)}
			{row(labels.previous, FLOW_COLOURS.muted, slot.previous, slot.previousDate)}
		</div>
	);
}

/**
 * Sure's `spending-chart`: the month shown's cumulative spending, in its
 * success green, over the previous month's whole curve in grey, on one
 * day-of-month axis. Apart so that recharts loads with the widget only.
 */
export function SpendingTrendChart({
	data,
	labels,
	className,
}: {
	data: SpendingTrendData;
	labels: { current: string; previous: string };
	/** The chart's height class, the widget's preset. */
	className: string;
}) {
	const slots = slotsOf(data);
	const ticks = [1, Math.ceil(data.days / 2), data.days];

	return (
		<ChartContainer config={{}} className={cn("aspect-auto w-full", className)}>
			<LineChart data={slots} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
				{/* Sure's `spending-chart`: four dashed lines and a compact money axis on the right. */}
				<CartesianGrid vertical={false} strokeDasharray="3 3" />
				<XAxis
					dataKey="day"
					type="number"
					domain={[1, data.days]}
					ticks={ticks}
					// Recharts drops the first of three ticks it thinks crowded; Sure always names day 1.
					interval={0}
					tickLine={false}
					axisLine={false}
					// Sure anchors the first day's label at its start and the last's at its end, so neither is clipped.
					tick={({ x, y, payload }: XAxisTickContentProps) => (
						<text
							x={x}
							y={Number(y) + 12}
							textAnchor={
								payload.value === 1 ? "start" : payload.value === data.days ? "end" : "middle"
							}
							className="fill-muted-foreground text-xs"
						>
							{shortDate(`${data.month}-${String(payload.value).padStart(2, "0")}`)}
						</text>
					)}
				/>
				<YAxis
					orientation="right"
					domain={[0, "auto"]}
					tickCount={4}
					tickLine={false}
					axisLine={false}
					width={48}
					// A nice tick over a few cents can fall between two minor units.
					tickFormatter={(amount: number) =>
						formatCompactMoney(toMinorUnits(Math.round(amount)), data.currency)
					}
				/>
				<ChartTooltip
					cursor={{ stroke: "var(--border)", strokeDasharray: "4 4" }}
					isAnimationActive={false}
					content={({ active, label }) => (
						<SpendingTooltip
							active={active}
							label={label}
							slots={slots}
							currency={data.currency}
							labels={labels}
						/>
					)}
				/>
				<Line
					dataKey="previous"
					type="monotone"
					stroke={FLOW_COLOURS.muted}
					strokeWidth={1.5}
					dot={false}
					isAnimationActive={false}
				/>
				<Line
					dataKey="current"
					type="monotone"
					stroke={FLOW_COLOURS.income}
					strokeWidth={2}
					dot={false}
					activeDot={{ r: 4 }}
					isAnimationActive={false}
				/>
			</LineChart>
		</ChartContainer>
	);
}
