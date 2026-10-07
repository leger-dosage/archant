import type { ChartConfig } from "@/components/ui/chart";
import type { LoanPayoffChartData } from "@/hooks/useLoanPayoffChart";
import type { UseQueryResult } from "@tanstack/react-query";
import type { TooltipContentProps } from "recharts";

import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from "recharts";

import type { MinorUnits } from "@archant/data/money";
import { formatMoney, isCurrencyCode, minorUnitsOf, toMinorUnits } from "@archant/data/money";

import { Money } from "@/components/Money";
import { SummaryCard } from "@/components/SummaryCard";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { errorCodeOf } from "@/lib/api";
import {
	formatCompactMoney,
	formatSignedMoney,
	formatSignedPercent,
	formatTick,
} from "@/lib/balance-change";
import { axisTicks } from "@/lib/chart-axis";
import { CHART_HEIGHTS, DEFAULT_CHART_HEIGHT } from "@/lib/chart-heights";
import { longDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

const HEIGHT = CHART_HEIGHTS[DEFAULT_CHART_HEIGHT];

type SeriesKey = LoanPayoffChartData["visible"][number];

type ChartPoint = LoanPayoffChartData["actual"][number];

/**
 * Sure's `loan_payoff_chart_controller` styles: dash and colour together, so a
 * line reads apart in greyscale and under deuteranopia, solid for what was
 * recorded and dashed for what is forecast. Sure's success and destructive are
 * Archant's trend pair, which both reach 3:1 on the card in either theme.
 */
const STYLES = {
	actual: { color: "var(--trend-up)", dash: undefined, width: 2 },
	scheduled: { color: "var(--trend-down)", dash: "6 4", width: 1.5 },
	projected: { color: "var(--trend-up)", dash: "4 4", width: 2 },
} as const satisfies Record<SeriesKey, { color: string; dash: string | undefined; width: number }>;

// As the balance chart's: past about six months, ticks name the month and year.
const LONG_RANGE_DAYS = 200;

const DAY_MS = 86_400_000;

// Sure thins each line's markers to about one per 60 pixels, so a 300-payment
// schedule does not become a solid band of circles.
const MARKER_SPACING = 60;

/** A day on the axis: milliseconds at UTC midnight, so the line to a far date keeps its slope. */
const atMidnight = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

const isoOf = (milliseconds: number) => new Date(milliseconds).toISOString().slice(0, 10);

type Row = { day: number; date: string } & Partial<Record<SeriesKey, MinorUnits>>;

/** One row per date any visible series plots, each holding the series that plot it. */
function rowsOf(chart: LoanPayoffChartData): Row[] {
	const byDate = new Map<string, Row>();

	for (const key of chart.visible) {
		for (const point of chart[key]) {
			const row = byDate.get(point.date) ?? { day: atMidnight(point.date), date: point.date };

			row[key] = point.balance;
			byDate.set(point.date, row);
		}
	}

	return [...byDate.values()].toSorted((a, b) => a.day - b.day);
}

const inDomain = (date: string, chart: LoanPayoffChartData) =>
	date >= chart.from && date <= chart.to;

/** The date among `dates` nearest `date`; `date` itself when there is none. */
function nearestDate(dates: readonly string[], date: string): string {
	const day = atMidnight(date);

	return dates.reduce<string>(
		(best, candidate) =>
			Math.abs(atMidnight(candidate) - day) < Math.abs(atMidnight(best) - day) ? candidate : best,
		dates.at(0) ?? date,
	);
}

/**
 * A series' point nearest a date, as Sure's tooltip reads it; none outside
 * the series' own span, about which it says nothing.
 */
function pointNear(points: readonly ChartPoint[], date: string): ChartPoint | undefined {
	const first = points.at(0);
	const last = points.at(-1);

	if (first === undefined || last === undefined || date < first.date || date > last.date) {
		return undefined;
	}

	const nearest = nearestDate(
		points.map((point) => point.date),
		date,
	);

	return points.find((point) => point.date === nearest);
}

/** `104 725 €`: Sure's tooltip rounds to the whole unit, here half up and in integers. */
function formatWholeMoney(amount: MinorUnits, currency: string): string {
	const unit = 10n ** BigInt(isCurrencyCode(currency) ? minorUnitsOf(currency) : 2);
	const whole = (BigInt(Math.abs(amount)) + unit / 2n) / unit;

	return new Intl.NumberFormat("fr-FR", { style: "currency", currency, maximumFractionDigits: 0 })
		.format(amount < 0 ? -whole : whole)
		.replace("-", "−");
}

function PayoffTooltip({
	active,
	label,
	chart,
	stops,
}: {
	active: TooltipContentProps["active"] | undefined;
	label: TooltipContentProps["label"] | undefined;
	chart: LoanPayoffChartData;
	stops: readonly string[];
}) {
	const { t } = useTranslation();

	if (active !== true || typeof label !== "number") {
		return null;
	}

	// Snapped to a payment date, as Sure's: the heading is then the date its
	// figures come from, where the recorded line's own points repeat a month.
	const date = nearestDate(stops, isoOf(label));
	const values = chart.visible.flatMap((key) => {
		const point = pointNear(chart[key], date);

		return point === undefined ? [] : [{ key, balance: point.balance }];
	});

	if (values.length === 0) {
		return null;
	}

	return (
		<div className="grid gap-1 rounded-lg border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
			<span className="text-muted-foreground">{formatTick(date, true)}</span>
			{values.map(({ key, balance }) => (
				<span key={key}>
					{t(`loanChart.series.${key}`)} :{" "}
					<span className="font-medium whitespace-nowrap tabular-nums">
						{formatWholeMoney(balance, chart.currency)}
					</span>
				</span>
			))}
		</div>
	);
}

/** The chart's width in pixels, which Sure's marker spacing reads. */
function useWidth() {
	const ref = useRef<HTMLDivElement>(null);
	const [width, setWidth] = useState(0);

	useEffect(() => {
		const element = ref.current;

		if (element === null) {
			return undefined;
		}

		const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));

		observer.observe(element);

		return () => observer.disconnect();
	}, []);

	return { ref, width };
}

function Chart({ chart }: { chart: LoanPayoffChartData }) {
	const { t } = useTranslation();
	const { ref, width } = useWidth();
	const config = {
		actual: { label: t("loanChart.series.actual"), color: STYLES.actual.color },
		scheduled: { label: t("loanChart.series.scheduled"), color: STYLES.scheduled.color },
		projected: { label: t("loanChart.series.projected"), color: STYLES.projected.color },
	} satisfies ChartConfig;
	const rows = rowsOf(chart);
	const from = atMidnight(chart.from);
	const to = atMidnight(chart.to);
	const longRange = (to - from) / DAY_MS > LONG_RANGE_DAYS;
	// From zero, as Sure's axis: a balance owed reads against nothing owed.
	const ticks = axisTicks([
		0,
		...rows
			.flatMap((row) => chart.visible.map((key) => row[key]))
			.filter((value) => value !== undefined),
	]);
	const shown = new Set(chart.visible);
	const scheduledDates = chart.scheduled
		.map((point) => point.date)
		.filter((date) => inDomain(date, chart));
	const stops =
		scheduledDates.length > 0
			? scheduledDates
			: rows.map((row) => row.date).filter((date) => inDomain(date, chart));
	const markers = (key: SeriesKey) => {
		const points = chart[key];
		const step = Math.max(1, Math.ceil(points.length / Math.max(2, width / MARKER_SPACING)));

		return new Set(points.filter((_, index) => index % step === 0).map((point) => point.date));
	};
	const dot = (key: SeriesKey) => {
		const marked = markers(key);

		return ({ cx, cy, payload }: { cx?: number; cy?: number; payload?: Row }) =>
			payload !== undefined && marked.has(payload.date) && payload[key] !== undefined ? (
				<circle key={payload.date} cx={cx} cy={cy} r={2.5} fill={STYLES[key].color} />
			) : (
				<g key={payload?.date} />
			);
	};
	const line = (key: Exclude<SeriesKey, "actual">) =>
		shown.has(key) && (
			<Line
				dataKey={key}
				type="monotone"
				stroke={`var(--color-${key})`}
				strokeWidth={STYLES[key].width}
				strokeDasharray={STYLES[key].dash}
				strokeLinecap="round"
				dot={dot(key)}
				activeDot={false}
				connectNulls
				isAnimationActive={false}
			/>
		);

	return (
		<div ref={ref}>
			<ChartContainer config={config} className={`aspect-auto w-full ${HEIGHT}`}>
				<ComposedChart
					accessibilityLayer
					data={rows}
					margin={{ top: 12, right: 12, bottom: 0, left: 0 }}
				>
					<CartesianGrid vertical={false} stroke="var(--grid)" />
					<XAxis
						dataKey="day"
						type="number"
						domain={[from, to]}
						// The series run one point past each edge, so a line crossing it is cut there.
						allowDataOverflow
						tickLine={false}
						axisLine={false}
						tickMargin={8}
						minTickGap={32}
						tickFormatter={(value: number) => formatTick(isoOf(value), longRange)}
					/>
					<YAxis
						domain={[ticks.at(0) ?? 0, ticks.at(-1) ?? "auto"]}
						ticks={ticks}
						allowDataOverflow
						tickLine={false}
						axisLine={false}
						tickMargin={4}
						width={64}
						tickFormatter={(value: number) =>
							formatCompactMoney(toMinorUnits(value), chart.currency)
						}
					/>
					<ChartTooltip
						cursor={{ stroke: "var(--border)" }}
						isAnimationActive={false}
						content={({ active, label }) => (
							<PayoffTooltip active={active} label={label} chart={chart} stops={stops} />
						)}
					/>
					{/* Sure's drawing order: forecasts underneath, fact on top. */}
					{line("scheduled")}
					{line("projected")}
					{shown.has("actual") && (
						<Area
							dataKey="actual"
							type="monotone"
							stroke="var(--color-actual)"
							strokeWidth={STYLES.actual.width}
							strokeLinecap="round"
							fill="var(--color-actual)"
							fillOpacity={0.08}
							dot={dot("actual")}
							activeDot={{ r: 4 }}
							connectNulls
							isAnimationActive={false}
						/>
					)}
					<ReferenceLine
						x={atMidnight(chart.asOf)}
						stroke="var(--foreground)"
						strokeOpacity={0.4}
						strokeDasharray="2 3"
						ifOverflow="hidden"
					/>
				</ComposedChart>
			</ChartContainer>
		</div>
	);
}

function Legend({ chart }: { chart: LoanPayoffChartData }) {
	const { t } = useTranslation();

	return (
		<ul
			aria-label={t("loanChart.legend")}
			className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
		>
			{chart.visible.map((key) => (
				<li key={key} className="flex items-center gap-1.5">
					<span
						aria-hidden="true"
						className={`inline-block h-0 w-4 border-t-2 ${STYLES[key].dash === undefined ? "" : "border-dashed"}`}
						style={{ borderColor: STYLES[key].color }}
					/>
					{t(`loanChart.series.${key}`)}
				</li>
			))}
		</ul>
	);
}

/**
 * Sure's cards beside the chart: the projected payoff and the interest it
 * saves when the projection converges, else what the contract's payments
 * leave owed at maturity; nothing when there is nothing to project.
 */
function Outcome({ chart }: { chart: LoanPayoffChartData }) {
	const { t } = useTranslation();
	const { projectedPayoff, monthsSaved, interestSaved, balloon } = chart;

	if (balloon !== null) {
		return (
			<p className="text-sm text-muted-foreground">
				{t("loanChart.notConverged", {
					balloon: formatMoney({ amount: balloon, currency: chart.currency }),
				})}
			</p>
		);
	}

	if (projectedPayoff.status !== "paid_off" || monthsSaved === null || interestSaved === null) {
		return null;
	}

	return (
		<div className="grid grid-cols-2 gap-2">
			<SummaryCard title={t("loanChart.projectedPayoff")}>
				{longDate(projectedPayoff.date)}
				<span className="mt-1 block text-xs font-normal text-muted-foreground">
					{monthsSaved === 0
						? t("loanChart.onSchedule")
						: t("loanChart.monthsSaved", { count: monthsSaved })}
				</span>
			</SummaryCard>
			<SummaryCard title={t("loanChart.interestSaved")}>
				<Money amount={interestSaved} currency={chart.currency} />
			</SummaryCard>
			<p className="col-span-2 text-xs text-muted-foreground">{t("loanChart.basis")}</p>
		</div>
	);
}

/**
 * Sure's change line on a loan: today's balance against the amount borrowed,
 * whatever the period. A loan is a liability, so a fall is the good news, in
 * the income green that keeps 4.5:1 where Sure's success colour has no token.
 */
function Trend({ chart }: { chart: LoanPayoffChartData }) {
	const { t } = useTranslation();
	const { amount, percent } = chart.change;

	if (amount === 0) {
		return (
			<p className="text-sm text-muted-foreground">
				{t("loanChart.noChange")} {t("loanChart.sinceStart")}
			</p>
		);
	}

	const Arrow = amount < 0 ? ArrowDownIcon : ArrowUpIcon;

	return (
		<p className="text-sm">
			<span className={cn("tabular-nums", amount < 0 ? "text-money-income" : "text-destructive")}>
				{formatSignedMoney(amount, chart.currency)}
				{percent !== null && (
					<>
						{" ("}
						<Arrow aria-hidden="true" className="mb-0.5 inline size-3.5" />
						{formatSignedPercent(percent)})
					</>
				)}
			</span>{" "}
			<span className="text-muted-foreground">{t("loanChart.sinceStart")}</span>
		</p>
	);
}

/** Sure's description for screen readers: the Échéancier tab carries the figures. */
function Description({ chart }: { chart: LoanPayoffChartData }) {
	const { t } = useTranslation();
	const firstRecorded = chart.actual.find((point) => point.date >= chart.from);
	const projectedPayoff =
		chart.projectedPayoff.status === "paid_off"
			? longDate(chart.projectedPayoff.date)
			: t("loanChart.noPayoff");

	return (
		<p className="sr-only">
			{t("loanChart.description", {
				balance: formatMoney({ amount: chart.balance, currency: chart.currency }),
				scheduledPayoff: longDate(chart.scheduledPayoffDate),
				projectedPayoff,
			})}
			{firstRecorded !== undefined &&
				firstRecorded.date > chart.from &&
				` ${t("loanChart.historyStarts", { date: longDate(firstRecorded.date) })}`}
		</p>
	);
}

/**
 * Sure's loan chart: the recorded balance, the contract and the projection
 * from today, over the account chart's period clamped to the loan's life,
 * under Sure's change line and cards, with its legend and a description for
 * screen readers.
 */
export function LoanChart({ chart }: { chart: UseQueryResult<LoanPayoffChartData | null> }) {
	const { t } = useTranslation();
	const data = chart.data;

	return (
		<>
			{chart.isPending && <Skeleton className={`${HEIGHT} w-full`} aria-hidden="true" />}

			{chart.isError && data === undefined && (
				<div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-8">
					<p className="text-muted-foreground">{t(`errors.${errorCodeOf(chart.error)}`)}</p>
					<Button variant="outline" onClick={() => void chart.refetch()}>
						{t("common.retry")}
					</Button>
				</div>
			)}

			{data !== undefined && data !== null && (
				<>
					<Trend chart={data} />
					<Outcome chart={data} />
					<Chart chart={data} />
					<Legend chart={data} />
					<Description chart={data} />
				</>
			)}
		</>
	);
}
