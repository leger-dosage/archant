import type { ChartConfig } from "@/components/ui/chart";
import type { GoalData, GoalHistoryData } from "@/hooks/useGoals";
import type { UseQueryResult } from "@tanstack/react-query";
import type { TooltipContentProps } from "recharts";

import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from "recharts";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";

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
	formatCompactMoney,
	formatShortDate,
	formatSignedMoney,
	formatTableDate,
	formatTick,
	formatTooltipDate,
} from "@/lib/balance-change";
import { axisTicks, goalDomain } from "@/lib/chart-axis";
import { CHART_HEIGHTS } from "@/lib/chart-heights";
import { formatMoney } from "@/lib/format-money";

const HEIGHT = CHART_HEIGHTS[256];

// As the balance chart's: past about six months, ticks name the month and year.
const LONG_RANGE_DAYS = 200;

const DAY_MS = 86_400_000;
const HUNDREDTHS_OF_DAYS_PER_PROJECTION_MONTH = 3044n;

/** A day on the axis: milliseconds at UTC midnight, so the line to a far date keeps its slope. */
const atMidnight = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

const isoOf = (milliseconds: number) => new Date(milliseconds).toISOString().slice(0, 10);

type Point = { day: number; date: string; saved?: MinorUnits; projection?: MinorUnits };

/** Sure's projection end, using 30.44 days per month and never below today's backing. */
function aheadOf(goal: GoalData, history: GoalHistoryData) {
	if (
		goal.state !== "active" ||
		goal.targetDate === null ||
		goal.targetDate <= history.to ||
		goal.remaining === 0 ||
		goal.pace === null
	) {
		return null;
	}

	const days = (atMidnight(goal.targetDate) - atMidnight(history.to)) / DAY_MS;
	const month = HUNDREDTHS_OF_DAYS_PER_PROJECTION_MONTH;
	const growth = (BigInt(Math.max(goal.pace, 0)) * BigInt(days) * 100n + month / 2n) / month;
	// A date far enough ahead can take a valid pace beyond the chart's integer range.
	const amount = toMinorUnits(Math.min(goal.saved + Number(growth), Number.MAX_SAFE_INTEGER));

	return { date: goal.targetDate, amount };
}

function pointsOf(goal: GoalData, history: GoalHistoryData): Point[] {
	const points: Point[] = history.points.map((point) => ({
		day: atMidnight(point.date),
		date: point.date,
		saved: point.saved,
	}));
	const last = points.at(-1);
	const ahead = aheadOf(goal, history);

	if (last === undefined || ahead === null) {
		return points;
	}

	return [
		...points.slice(0, -1),
		{ ...last, projection: goal.saved },
		{ day: atMidnight(ahead.date), date: ahead.date, projection: ahead.amount },
	];
}

function Summary({ goal, history }: { goal: GoalData; history: GoalHistoryData }) {
	const { t } = useTranslation();
	const first = history.points.at(0)?.saved ?? toMinorUnits(0);
	const saved = goal.saved;
	const money = (amount: MinorUnits) => formatMoney({ amount, currency: goal.currency });
	const ahead = aheadOf(goal, history);

	return (
		<p className="text-sm text-muted-foreground">
			{t("goals.chart.summary", {
				saved: money(saved),
				change: formatSignedMoney(toMinorUnits(saved - first), goal.currency),
				from: formatShortDate(history.from),
				target: money(goal.targetAmount),
			})}
			{ahead !== null &&
				` ${t("goals.chart.projection", {
					date: formatShortDate(ahead.date),
					amount: money(ahead.amount),
				})}`}
			{goal.status === "pace_unknown" &&
				goal.state === "active" &&
				` ${t("goals.chart.paceUnknown")}`}
		</p>
	);
}

function GoalTooltip({
	active,
	label,
	byDay,
	currency,
}: {
	active: TooltipContentProps["active"] | undefined;
	label: TooltipContentProps["label"] | undefined;
	byDay: ReadonlyMap<number, Point>;
	currency: string;
}) {
	const { t } = useTranslation();
	const point = typeof label === "number" ? byDay.get(label) : undefined;

	if (active !== true || point === undefined) {
		return null;
	}

	return (
		<div className="grid gap-1 rounded-lg border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
			<span className="text-muted-foreground">{formatTooltipDate(point.date)}</span>
			{point.saved !== undefined && (
				<span>
					{t("goals.chart.saved")} : <Money amount={point.saved} currency={currency} />
				</span>
			)}
			{point.projection !== undefined && point.saved === undefined && (
				<span>
					{t("goals.chart.projected")} : <Money amount={point.projection} currency={currency} />
				</span>
			)}
		</div>
	);
}

function Chart({ goal, history }: { goal: GoalData; history: GoalHistoryData }) {
	const { t } = useTranslation();
	const gradientId = useId();
	const config = {
		saved: { label: t("goals.chart.saved"), color: "var(--accent-brand)" },
		projection: { label: t("goals.chart.projected"), color: "var(--accent-brand)" },
		target: { label: t("goals.chart.target"), color: "var(--muted-foreground)" },
	} satisfies ChartConfig;
	const points = pointsOf(goal, history);
	const byDay = new Map(points.map((point) => [point.day, point]));
	const first = points.at(0)?.day ?? 0;
	const last = points.at(-1)?.day ?? 0;
	const longRange = (last - first) / DAY_MS > LONG_RANGE_DAYS;
	const saved = points.map((point) => point.saved).filter((value) => value !== undefined);
	const projections = points
		.map((point) => point.projection)
		.filter((value) => value !== undefined);
	const domain = goalDomain({ target: goal.targetAmount, projections, saved }, goal.currency);
	const ticks = axisTicks(domain, goal.currency, [...saved, ...projections, goal.targetAmount]);

	return (
		<ChartContainer config={config} className={`aspect-auto w-full ${HEIGHT}`}>
			<ComposedChart
				accessibilityLayer
				data={points}
				margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
			>
				<defs>
					<linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
						<stop offset="0%" stopColor="var(--color-saved)" stopOpacity={0.14} />
						<stop offset="100%" stopColor="var(--color-saved)" stopOpacity={0} />
					</linearGradient>
				</defs>
				<CartesianGrid vertical={false} stroke="var(--grid)" />
				<XAxis
					dataKey="day"
					type="number"
					domain={[first, last]}
					tickLine={false}
					axisLine={false}
					tickMargin={8}
					minTickGap={32}
					tickFormatter={(value: number) => formatTick(isoOf(value), longRange)}
				/>
				<YAxis
					domain={[...domain]}
					ticks={ticks}
					// Sure clips a saved line past twice the goal's own scale inside the plot.
					allowDataOverflow
					tickLine={false}
					axisLine={false}
					tickMargin={4}
					width={64}
					tickFormatter={(value: number) => formatCompactMoney(toMinorUnits(value), goal.currency)}
				/>
				<ChartTooltip
					cursor={{ stroke: "var(--border)" }}
					isAnimationActive={false}
					content={({ active, label }) => (
						<GoalTooltip active={active} label={label} byDay={byDay} currency={goal.currency} />
					)}
				/>
				<ReferenceLine
					y={goal.targetAmount}
					stroke="var(--color-target)"
					strokeDasharray="6 4"
					ifOverflow="extendDomain"
				/>
				<Area
					dataKey="saved"
					type="linear"
					stroke="var(--color-saved)"
					strokeWidth={1.5}
					fill={`url(#${CSS.escape(gradientId)})`}
					dot={history.points.length === 1}
					activeDot={{ r: 4 }}
					isAnimationActive={false}
				/>
				{projections.length > 0 && (
					<Line
						dataKey="projection"
						type="linear"
						stroke="var(--color-projection)"
						strokeWidth={1.5}
						strokeDasharray="3 3"
						dot={false}
						activeDot={false}
						connectNulls
						isAnimationActive={false}
					/>
				)}
			</ComposedChart>
		</ChartContainer>
	);
}

function DataTable({
	goal,
	history,
	id,
}: {
	goal: GoalData;
	history: GoalHistoryData;
	id: string;
}) {
	const { t } = useTranslation();

	return (
		<div id={id} className={`${HEIGHT} overflow-y-auto rounded-lg border`}>
			<Table>
				<TableHeader className="sticky top-0 bg-card">
					<TableRow>
						<TableHead scope="col">{t("balances.date")}</TableHead>
						<TableHead scope="col" className="text-right">
							{t("goals.chart.saved")}
						</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{history.points.toReversed().map((point) => (
						<TableRow key={point.date}>
							<TableCell>{formatTableDate(point.date)}</TableCell>
							<TableCell className="text-right">
								<Money amount={point.saved} currency={goal.currency} />
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

/**
 * A goal's chart, as Sure's projection panel: what it saved each day over
 * its last 90 days, a dashed line at its target and, with a date ahead and
 * measured pace, the projected amount on its target date. A
 * sentence above says it in words, and the days read as a table on demand
 * (EXPERIENCE.md, accessibility floor).
 */
export function GoalChart({
	goal,
	history,
}: {
	goal: GoalData;
	history: UseQueryResult<GoalHistoryData>;
}) {
	const { t } = useTranslation();
	const [showTable, setShowTable] = useState(false);
	const tableId = useId();
	const data = history.data;
	// The line meets today's backing, even when another linked account is overdrawn.
	const displayedHistory =
		data === undefined
			? undefined
			: {
					...data,
					points: data.points.map((point) =>
						point.date === data.to ? { ...point, saved: goal.saved } : point,
					),
				};

	return (
		<div className="flex flex-col gap-3 p-4">
			{history.isPending && <Skeleton className={`${HEIGHT} w-full`} aria-hidden="true" />}

			{history.isError && data === undefined && (
				<div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-8">
					<p className="text-muted-foreground">{t(`errors.${errorCodeOf(history.error)}`)}</p>
					<Button variant="outline" onClick={() => void history.refetch()}>
						{t("common.retry")}
					</Button>
				</div>
			)}

			{displayedHistory !== undefined && (
				<>
					<Summary goal={goal} history={displayedHistory} />
					{showTable ? (
						<DataTable goal={goal} history={displayedHistory} id={tableId} />
					) : (
						<Chart goal={goal} history={displayedHistory} />
					)}
					<div>
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
		</div>
	);
}
