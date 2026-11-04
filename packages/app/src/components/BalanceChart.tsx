import type { ChartConfig } from "@/components/ui/chart";
import type { BalanceHistoryData } from "@/hooks/useBalanceHistory";
import type { ChartHeight } from "@/lib/chart-heights";
import type { UseQueryResult } from "@tanstack/react-query";
import type { TooltipContentProps, XAxisTickContentProps } from "recharts";

import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Area, AreaChart, XAxis, YAxis } from "recharts";

import { Money } from "@/components/Money";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { errorCodeOf } from "@/lib/api";
import {
	changeText,
	formatShortDate,
	formatTableDate,
	formatTooltipDate,
} from "@/lib/balance-change";
import { balanceDomain, edgeDates } from "@/lib/chart-axis";
import { CHART_HEIGHTS, DEFAULT_CHART_HEIGHT } from "@/lib/chart-heights";
import { formatMoney } from "@/lib/format-money";

/**
 * What the chart draws: an account's balance history or the household's net
 * worth, both one point per day of a period with its change.
 */
export type ChartHistory = Pick<BalanceHistoryData, "period" | "currency" | "points" | "change">;

type Point = ChartHistory["points"][number];

/** The sentence above the chart, which names what the line is. */
type SummaryKey = "balances.summary" | "dashboard.summary";

function Summary({ history, summaryKey }: { history: ChartHistory; summaryKey: SummaryKey }) {
	const { t } = useTranslation();
	const last = history.points.at(-1);

	if (last === undefined || history.change === null) {
		return null;
	}

	const change = changeText(t, history.change, history.currency);

	return (
		<p className="text-sm text-muted-foreground">
			{t(summaryKey, {
				balance: formatMoney({ amount: last.balance, currency: history.currency }),
				change,
				over: t(`balances.over.${history.period}`),
			})}
		</p>
	);
}

function BalanceTooltip({
	active,
	label,
	byDate,
	currency,
}: {
	active: TooltipContentProps["active"] | undefined;
	label: TooltipContentProps["label"] | undefined;
	byDate: ReadonlyMap<string, Point>;
	currency: string;
}) {
	const point = typeof label === "string" ? byDate.get(label) : undefined;

	if (active !== true || point === undefined) {
		return null;
	}

	return (
		<div className="grid gap-1 rounded-lg border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
			<span className="text-muted-foreground">{formatTooltipDate(point.date)}</span>
			<Money amount={point.balance} currency={currency} />
		</div>
	);
}

/**
 * One of the two dates under the chart, kept inside its edge: the first reads
 * from the left edge, the last ends at the right one, where Sure shifts both
 * by a fixed 5 em that a short French date would overshoot.
 */
function EdgeTick({ x, y, payload, index }: XAxisTickContentProps) {
	return (
		<text
			x={x}
			y={y}
			dy="0.71em"
			textAnchor={index === 0 ? "start" : "end"}
			data-slot="axis-date"
			className="fill-muted-foreground"
		>
			{formatShortDate(String(payload.value))}
		</text>
	);
}

/**
 * Sure's `_drawEmpty`: a lone point, such as an account opened today, has no
 * line to draw, so a dashed vertical line and a dot mark it at the centre.
 */
function ChartEmpty({ height }: { height: ChartHeight }) {
	return (
		<svg data-slot="chart-empty" aria-hidden="true" className={`w-full ${CHART_HEIGHTS[height]}`}>
			<line
				data-slot="chart-empty-line"
				x1="50%"
				y1="0"
				x2="50%"
				y2="100%"
				stroke="var(--border)"
				strokeDasharray="4 4"
			/>
			<circle
				data-slot="chart-empty-dot"
				cx="50%"
				cy="50%"
				r={4}
				className="fill-muted-foreground"
			/>
		</svg>
	);
}

function Chart({
	history,
	valueLabel,
	height,
}: {
	history: ChartHistory;
	valueLabel: string;
	height: ChartHeight;
}) {
	const gradientId = useId();
	const config = {
		balance: { label: valueLabel, color: "var(--accent-brand)" },
	} satisfies ChartConfig;

	if (history.points.length === 1) {
		return <ChartEmpty height={height} />;
	}

	const byDate = new Map(history.points.map((point) => [point.date, point]));
	const balances = history.points.map((point) => point.balance);
	const domain = balanceDomain(balances, history.currency);
	const ticks = edgeDates(history.points);

	return (
		<ChartContainer config={config} className={`aspect-auto w-full ${CHART_HEIGHTS[height]}`}>
			{/* Arrow keys move the tooltip cursor one day at a time. */}
			<AreaChart
				accessibilityLayer
				data={history.points}
				margin={{ top: 8, right: 0, bottom: 0, left: 0 }}
			>
				<defs>
					<linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
						<stop offset="0%" stopColor="var(--color-balance)" stopOpacity={0.14} />
						<stop offset="100%" stopColor="var(--color-balance)" stopOpacity={0} />
					</linearGradient>
				</defs>
				{/* Sure's `time_series_chart_controller` draws no grid and no vertical axis. */}
				<XAxis
					dataKey="date"
					ticks={ticks}
					interval={0}
					tickLine={false}
					axisLine={false}
					tickMargin={8}
					tick={(props: XAxisTickContentProps) => <EdgeTick {...props} />}
				/>
				<YAxis domain={[...domain]} hide />
				<ChartTooltip
					cursor={{ stroke: "var(--border)" }}
					isAnimationActive={false}
					content={({ active, label }) => (
						<BalanceTooltip
							active={active}
							label={label}
							byDate={byDate}
							currency={history.currency}
						/>
					)}
				/>
				<Area
					dataKey="balance"
					type="linear"
					stroke="var(--color-balance)"
					strokeWidth={1.5}
					fill={`url(#${CSS.escape(gradientId)})`}
					activeDot={{ r: 4 }}
					isAnimationActive={false}
				/>
			</AreaChart>
		</ChartContainer>
	);
}

function DataTable({
	history,
	id,
	valueLabel,
	height,
}: {
	history: ChartHistory;
	id: string;
	valueLabel: string;
	height: ChartHeight;
}) {
	const { t } = useTranslation();

	return (
		<div id={id} className={`${CHART_HEIGHTS[height]} overflow-y-auto rounded-lg border`}>
			<Table>
				<TableHeader className="sticky top-0 bg-card">
					<TableRow>
						<TableHead scope="col">{t("balances.date")}</TableHead>
						<TableHead scope="col" className="text-right">
							{valueLabel}
						</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{history.points.toReversed().map((point) => (
						<TableRow key={point.date}>
							<TableCell>{formatTableDate(point.date)}</TableCell>
							<TableCell className="text-right">
								<Money amount={point.balance} currency={history.currency} />
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

export type BalanceChartProps = {
	history: UseQueryResult<ChartHistory>;
	summaryKey: SummaryKey;
	/** The table's column header, such as « Solde ». */
	valueLabel: string;
	/** In pixels, the table's as well as the chart's. */
	height?: ChartHeight;
};

/**
 * A daily series over a period, with a text summary above and the same series
 * as a table on demand (EXPERIENCE.md, accessibility floor). The caller owns
 * the query and the period control, so an account and the net worth share it.
 */
export function BalanceChart({
	history,
	summaryKey,
	valueLabel,
	height = DEFAULT_CHART_HEIGHT,
}: BalanceChartProps) {
	const { t } = useTranslation();
	const [showTable, setShowTable] = useState(false);
	const tableId = useId();
	const data = history.data;

	return (
		<>
			{history.isPending && (
				<Skeleton className={`${CHART_HEIGHTS[height]} w-full`} aria-hidden="true" />
			)}

			{history.isError && data === undefined && (
				<div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-8">
					<p className="text-muted-foreground">{t(`errors.${errorCodeOf(history.error)}`)}</p>
					<Button variant="outline" onClick={() => void history.refetch()}>
						{t("common.retry")}
					</Button>
				</div>
			)}

			{data !== undefined && data.points.length === 0 && (
				// The chart's card frames it already.
				<p className="py-8 text-muted-foreground">{t("balances.empty")}</p>
			)}

			{data !== undefined && data.points.length > 0 && (
				<>
					{showTable ? (
						<DataTable history={data} id={tableId} valueLabel={valueLabel} height={height} />
					) : (
						<Chart history={data} valueLabel={valueLabel} height={height} />
					)}
					<div className="flex flex-wrap items-center justify-between gap-3">
						<Summary history={data} summaryKey={summaryKey} />
						<Button
							variant="ghost"
							size="sm"
							aria-expanded={showTable}
							aria-controls={showTable ? tableId : undefined}
							onClick={() => setShowTable((shown) => !shown)}
						>
							{t("balances.showData")}
						</Button>
					</div>
				</>
			)}
		</>
	);
}
