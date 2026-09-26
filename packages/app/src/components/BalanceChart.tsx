import type { ChartConfig } from "@/components/ui/chart";
import type { BalanceHistoryData } from "@/hooks/useBalanceHistory";
import type { UseQueryResult } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import type { TooltipContentProps } from "recharts";

import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Line, LineChart, XAxis, YAxis } from "recharts";

import type { BalancePeriod } from "@archant/api/schemas/balances";
import { BALANCE_PERIODS } from "@archant/api/schemas/balances";
import { formatMoney } from "@archant/data/money";

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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { errorCodeOf } from "@/lib/api";
import {
	formatSignedMoney,
	formatSignedPercent,
	formatTableDate,
	formatTick,
	formatTooltipDate,
} from "@/lib/balance-change";

/**
 * What the chart draws: an account's balance history or the household's net
 * worth, both one point per day of a period with its change.
 */
export type ChartHistory = Pick<BalanceHistoryData, "period" | "currency" | "points" | "change">;

type Point = ChartHistory["points"][number];

/** The sentence above the chart, which names what the line is. */
type SummaryKey = "balances.summary" | "dashboard.summary";

const CHART_HEIGHT = "h-64";

// Past about six months the axis spans a year boundary or its own day, so
// ticks name the month and year instead of the day.
const LONG_RANGE_POINTS = 200;

function isPeriod(value: string): value is BalancePeriod {
	return BALANCE_PERIODS.some((period) => period === value);
}

/** `+12,40 € (+1,0 %)`, or the amount alone when the period starts at zero. */
export function changeText(
	t: TFunction,
	change: NonNullable<ChartHistory["change"]>,
	currency: string,
): string {
	const amount = formatSignedMoney(change.amount, currency);

	return change.percent === null
		? amount
		: t("balances.changeWithPercent", {
				amount,
				percent: formatSignedPercent(change.percent),
			});
}

function Summary({ history, summaryKey }: { history: ChartHistory; summaryKey: SummaryKey }) {
	const { t } = useTranslation();
	const last = history.points.at(-1);

	if (last === undefined || history.change === null) {
		return null;
	}

	const change = changeText(t, history.change, history.currency);

	return (
		<p className="text-sm">
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

function Chart({ history, valueLabel }: { history: ChartHistory; valueLabel: string }) {
	const config = {
		balance: { label: valueLabel, color: "var(--chart-1)" },
	} satisfies ChartConfig;
	const byDate = new Map(history.points.map((point) => [point.date, point]));
	const longRange = history.points.length > LONG_RANGE_POINTS;

	return (
		<ChartContainer config={config} className={`aspect-auto w-full ${CHART_HEIGHT}`}>
			{/* Arrow keys move the tooltip cursor one day at a time. */}
			<LineChart
				accessibilityLayer
				data={history.points}
				margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
			>
				{/* No grid: the axis line is the one faint baseline. */}
				<XAxis
					dataKey="date"
					tickLine={false}
					axisLine={{ stroke: "var(--border)" }}
					tickMargin={8}
					minTickGap={32}
					tickFormatter={(value: string) => formatTick(value, longRange)}
				/>
				<YAxis hide domain={["dataMin", "dataMax"]} />
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
				<Line
					dataKey="balance"
					type="linear"
					stroke="var(--color-balance)"
					strokeWidth={2}
					// A lone point, such as an account opened today, draws no line.
					dot={history.points.length === 1}
					activeDot={{ r: 4 }}
					isAnimationActive={false}
				/>
			</LineChart>
		</ChartContainer>
	);
}

function DataTable({
	history,
	id,
	valueLabel,
}: {
	history: ChartHistory;
	id: string;
	valueLabel: string;
}) {
	const { t } = useTranslation();

	return (
		<div id={id} className={`${CHART_HEIGHT} overflow-y-auto rounded-lg border`}>
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

/** The « 1 M, 3 M, 6 M, 1 A, Tout » segmented control. */
export function PeriodToggle({
	period,
	onPeriodChange,
}: {
	period: BalancePeriod;
	onPeriodChange: (period: BalancePeriod) => void;
}) {
	const { t } = useTranslation();

	return (
		<ToggleGroup
			type="single"
			variant="outline"
			size="sm"
			spacing={0}
			aria-label={t("balances.period")}
			value={period}
			// Radix reports an empty value when the pressed item is pressed
			// again; a period is always selected.
			onValueChange={(value) => {
				if (isPeriod(value)) {
					onPeriodChange(value);
				}
			}}
		>
			{BALANCE_PERIODS.map((option) => (
				<ToggleGroupItem key={option} value={option}>
					{t(`balances.periods.${option}`)}
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	);
}

type BalanceChartProps = {
	history: UseQueryResult<ChartHistory>;
	summaryKey: SummaryKey;
	/** The table's column header, such as « Solde ». */
	valueLabel: string;
};

/**
 * A daily series over a period, with a text summary above and the same series
 * as a table on demand (EXPERIENCE.md, accessibility floor). The caller owns
 * the query and the period control, so an account and the net worth share it.
 */
export function BalanceChart({ history, summaryKey, valueLabel }: BalanceChartProps) {
	const { t } = useTranslation();
	const [showTable, setShowTable] = useState(false);
	const tableId = useId();
	const data = history.data;

	return (
		<>
			{history.isPending && <Skeleton className={`${CHART_HEIGHT} w-full`} aria-hidden="true" />}

			{history.isError && data === undefined && (
				<div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-8">
					<p className="text-muted-foreground">{t(`errors.${errorCodeOf(history.error)}`)}</p>
					<Button variant="outline" onClick={() => void history.refetch()}>
						{t("common.retry")}
					</Button>
				</div>
			)}

			{data !== undefined && data.points.length === 0 && (
				<p className="rounded-lg border border-dashed p-8 text-muted-foreground">
					{t("balances.empty")}
				</p>
			)}

			{data !== undefined && data.points.length > 0 && (
				<>
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
					{showTable ? (
						<DataTable history={data} id={tableId} valueLabel={valueLabel} />
					) : (
						<Chart history={data} valueLabel={valueLabel} />
					)}
				</>
			)}
		</>
	);
}
