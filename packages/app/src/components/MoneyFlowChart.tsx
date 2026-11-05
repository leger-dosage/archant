import type { MoneyFlowData } from "@/hooks/useMoneyFlow";
import type { AxisLabels } from "@/lib/money-flow";
import type { TooltipContentProps, XAxisTickContentProps } from "recharts";

import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bar, BarChart, Cell, XAxis, YAxis } from "recharts";

import { toMinorUnits } from "@archant/data/money";

import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { formatMoney } from "@/lib/format-money";
import { intlLocale } from "@/lib/locale";
import { FLOW_COLOURS, axisLabelsFit, showsAlternateTick } from "@/lib/money-flow";

type MonthBar = MoneyFlowData["bars"][number];

const MONEY_FLOW_COLOURS = { income: FLOW_COLOURS.income, expenses: FLOW_COLOURS.muted } as const;

const shortMonth = new Intl.DateTimeFormat(intlLocale, {
	month: "short",
	year: "numeric",
	timeZone: "UTC",
});

const monthOnly = new Intl.DateTimeFormat(intlLocale, { month: "short", timeZone: "UTC" });

const monthTick = (month: string) => shortMonth.format(new Date(`${month}-01T00:00:00Z`));

/** Sure's `short_label`, `%b`: the fallback when the full label does not fit its band. */
const monthShortTick = (month: string) => monthOnly.format(new Date(`${month}-01T00:00:00Z`));

/** Each text's width in the axis labels' font, as Sure measures what it rendered. */
function measured(element: Element, texts: readonly string[]): number[] {
	const context = document.createElement("canvas").getContext("2d");

	if (context === null) {
		return texts.map(() => 0);
	}

	const style = getComputedStyle(element);
	context.font = `600 12px ${style.fontFamily}`;

	return texts.map((text) => context.measureText(text).width);
}

function MoneyFlowTooltip({
	active,
	label,
	byMonth,
	currency,
}: {
	active: TooltipContentProps["active"] | undefined;
	label: TooltipContentProps["label"] | undefined;
	byMonth: ReadonlyMap<string, MonthBar>;
	currency: string;
}) {
	const { t } = useTranslation();
	const bar = typeof label === "string" ? byMonth.get(label) : undefined;

	if (!(active ?? false) || bar === undefined) {
		return null;
	}

	const row = (name: string, colour: string, amount: number) => (
		<div className="flex items-center gap-2">
			<span
				aria-hidden="true"
				className="inline-block size-2 rounded-full"
				style={{ backgroundColor: colour }}
			/>
			<span className="text-muted-foreground">{name}</span>
			<span className="ml-auto font-medium tabular-nums">
				{formatMoney({ amount: toMinorUnits(amount), currency })}
			</span>
		</div>
	);

	return (
		<div className="flex min-w-44 flex-col gap-1 rounded-lg border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md">
			<span className="font-medium capitalize">{monthTick(bar.month)}</span>
			{row(t("dashboard.moneyFlow.income"), MONEY_FLOW_COLOURS.income, bar.income)}
			{row(t("dashboard.moneyFlow.expenses"), MONEY_FLOW_COLOURS.expenses, Math.abs(bar.expenses))}
		</div>
	);
}

/**
 * Sure's `bar-chart` of « Entrées / sorties d'argent »: each month's gross
 * income and expenses side by side, unsigned, the month picked named in bold
 * and a month still running half-transparent. Apart so that recharts loads
 * with the widget only.
 */
export function MoneyFlowChart({ data }: { data: MoneyFlowData }) {
	const bars = data.bars.map((bar) => ({ ...bar, expense: Math.abs(bar.expenses) }));
	const byMonth = new Map(data.bars.map((bar) => [bar.month, bar]));
	const highlighted = bars.findIndex((bar) => bar.highlighted);
	const box = useRef<HTMLDivElement>(null);
	const [fit, setFit] = useState<AxisLabels>("full");

	// Measured, not guessed: a label's width depends on the locale and the font.
	useLayoutEffect(() => {
		const element = box.current;

		if (element === null) {
			return undefined;
		}

		const months = data.bars.map((bar) => bar.month);
		const full = measured(element, months.map(monthTick));
		const short = measured(element, months.map(monthShortTick));
		const update = () =>
			setFit(axisLabelsFit(full, short, element.clientWidth / Math.max(months.length, 1)));
		update();
		const observer = new ResizeObserver(update);
		observer.observe(element);

		return () => observer.disconnect();
	}, [data.bars]);

	return (
		<div ref={box}>
			<ChartContainer config={{}} className="aspect-auto h-44 w-full">
				<BarChart
					data={bars}
					barCategoryGap="30%"
					barGap={2}
					margin={{ top: 8, right: 0, bottom: 0, left: 0 }}
				>
					<XAxis
						dataKey="month"
						tickLine={false}
						axisLine={false}
						tickMargin={8}
						interval={0}
						tick={({ x, y, payload, index }: XAxisTickContentProps) => (
							<text
								x={x}
								y={y}
								dy="0.71em"
								textAnchor="middle"
								className="fill-muted-foreground text-xs capitalize"
								style={{
									fontWeight: bars[index]?.highlighted === true ? 600 : 500,
									display:
										fit === "alternate" && !showsAlternateTick(index, highlighted)
											? "none"
											: undefined,
								}}
							>
								{fit === "full"
									? monthTick(String(payload.value))
									: monthShortTick(String(payload.value))}
							</text>
						)}
					/>
					<YAxis hide />
					<ChartTooltip
						cursor={{ fill: "var(--hover)" }}
						isAnimationActive={false}
						content={({ active, label }) => (
							<MoneyFlowTooltip
								active={active}
								label={label}
								byMonth={byMonth}
								currency={data.currency}
							/>
						)}
					/>
					<Bar dataKey="income" radius={[4, 4, 0, 0]} isAnimationActive={false}>
						{bars.map((bar) => (
							<Cell
								key={bar.month}
								fill={MONEY_FLOW_COLOURS.income}
								fillOpacity={bar.partial ? 0.5 : 1}
							/>
						))}
					</Bar>
					<Bar dataKey="expense" radius={[4, 4, 0, 0]} isAnimationActive={false}>
						{bars.map((bar) => (
							<Cell
								key={bar.month}
								fill={MONEY_FLOW_COLOURS.expenses}
								fillOpacity={bar.partial ? 0.5 : 1}
							/>
						))}
					</Bar>
				</BarChart>
			</ChartContainer>
		</div>
	);
}
