import type { CashFlowData, CashFlowLine } from "@/hooks/useCashFlow";

import { Link } from "@tanstack/react-router";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pie, PieChart } from "recharts";

import { UNCATEGORISED } from "@archant/api/schemas/transactions";
import { formatMoney, toMinorUnits } from "@archant/data/money";

import { InsetGroup } from "@/components/InsetGroup";
import { Money } from "@/components/Money";
import { Section } from "@/components/Section";
import { SummaryStrip } from "@/components/SummaryStrip";
import { TintedIcon } from "@/components/TintedIcon";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useCashFlow } from "@/hooks/useCashFlow";
import { errorCodeOf } from "@/lib/api";
import { addMonthsTo, ofMonth } from "@/lib/dates";
import { cn } from "@/lib/utils";

type Side = "expense" | "income";

const SIDES: readonly Side[] = ["expense", "income"];

const isSide = (value: string): value is Side => SIDES.some((side) => side === value);

const shareFormat = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 1 });

const DONUT_SIZE = 128;

/** The side's usual sign: a line against it, a net refund, draws no segment. */
const alongSide = (line: CashFlowLine, side: Side) =>
	side === "expense" ? line.amount < 0 : line.amount > 0;

function CategoryRow({ line, side, data }: { line: CashFlowLine; side: Side; data: CashFlowData }) {
	const { t } = useTranslation();

	return (
		<li>
			<Link
				to="/transactions"
				search={{
					category: [line.categoryId ?? UNCATEGORISED],
					// « Sans catégorie » sits on both sides: its list keeps this side's rows.
					...(line.categoryId === null ? { direction: [side] } : {}),
					from: data.from,
					to: data.to,
				}}
				className="grid min-h-12 grid-cols-[auto_minmax(0,1fr)_auto_3.5rem] items-center gap-3 px-4 py-2.5 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
			>
				<TintedIcon
					subject={
						line.color === null || line.icon === null
							? { kind: "uncategorised" }
							: { kind: "category", color: line.color, icon: line.icon }
					}
				/>
				<span className="truncate" title={line.name ?? t("dashboard.cashFlow.uncategorised")}>
					{line.name ?? t("dashboard.cashFlow.uncategorised")}
				</span>
				<Money amount={line.amount} currency={data.currency} plusSign className="text-right" />
				<span className="text-right text-sm text-muted-foreground tabular-nums">
					{line.share === null ? "" : shareFormat.format(line.share).replace("-", "−")}
				</span>
			</Link>
		</li>
	);
}

/**
 * A thin ring of the side's lines in their category colours, the side's total
 * in its centre. The chart is one image to assistive technology, named by a
 * sentence; the rows beside it carry each figure.
 */
function Donut({ side, data, lines }: { side: Side; data: CashFlowData; lines: CashFlowLine[] }) {
	const { t } = useTranslation();
	const segments = lines
		.filter((line) => alongSide(line, side))
		.map((line) => ({
			key: line.categoryId ?? UNCATEGORISED,
			value: Math.abs(line.amount),
			fill: line.color ?? "var(--muted-foreground)",
		}));

	if (segments.length === 0) {
		return null;
	}

	const total = toMinorUnits(Math.abs(side === "expense" ? data.expenses : data.income));
	const label = t(`dashboard.cashFlow.donut.${side}`, {
		ofMonth: ofMonth(data.month),
		total: formatMoney({ amount: total, currency: data.currency }),
		count: segments.length,
	});

	return (
		<div
			role="img"
			aria-label={label}
			className="relative shrink-0 self-center"
			style={{ width: DONUT_SIZE, height: DONUT_SIZE }}
		>
			<PieChart
				width={DONUT_SIZE}
				height={DONUT_SIZE}
				margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
			>
				<Pie
					data={segments}
					dataKey="value"
					nameKey="key"
					innerRadius={DONUT_SIZE / 2 - 6}
					outerRadius={DONUT_SIZE / 2 - 1}
					startAngle={90}
					endAngle={-270}
					stroke="none"
					rootTabIndex={-1}
					isAnimationActive={false}
				/>
			</PieChart>
			<div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
				<span className="text-xs text-muted-foreground">
					{t(side === "expense" ? "dashboard.cashFlow.expenses" : "dashboard.cashFlow.income")}
				</span>
				<Money amount={total} currency={data.currency} />
			</div>
		</div>
	);
}

/**
 * « Flux de septembre 2026 »: the month's income, expenses and savings, then
 * one side broken down by top-level category, as a donut and as rows that
 * open their transactions. `current` is this month in the browser's zone,
 * after which nothing lies.
 */
export function CashFlowSection({
	month,
	current,
	onMonthChange,
}: {
	month: string;
	current: string;
	onMonthChange: (month: string) => void;
}) {
	const { t } = useTranslation();
	const [side, setSide] = useState<Side>("expense");
	const cashFlow = useCashFlow(month);
	const data = cashFlow.data;
	const placeholder = cashFlow.isPlaceholderData;
	const lines = data?.lines[side] ?? [];
	const empty =
		data !== undefined && data.lines.income.length === 0 && data.lines.expense.length === 0;

	return (
		<Section
			id="cash-flow-heading"
			title={t("dashboard.cashFlow.title", { ofMonth: ofMonth(month) })}
			action={
				<div className="flex items-center gap-2">
					<ToggleGroup
						type="single"
						variant="outline"
						size="sm"
						spacing={0}
						aria-label={t("dashboard.cashFlow.side")}
						value={side}
						// Radix reports an empty value when the pressed item is pressed again.
						onValueChange={(value) => {
							if (isSide(value)) {
								setSide(value);
							}
						}}
					>
						<ToggleGroupItem value="expense">{t("dashboard.cashFlow.expenses")}</ToggleGroupItem>
						<ToggleGroupItem value="income">{t("dashboard.cashFlow.income")}</ToggleGroupItem>
					</ToggleGroup>
					<div className="flex gap-1">
						<Button
							variant="outline"
							size="icon-sm"
							aria-label={t("dashboard.cashFlow.previous")}
							onClick={() => onMonthChange(addMonthsTo(month, -1))}
						>
							<ChevronLeftIcon />
						</Button>
						<Button
							variant="outline"
							size="icon-sm"
							aria-label={t("dashboard.cashFlow.next")}
							disabled={month >= current}
							onClick={() => onMonthChange(addMonthsTo(month, 1))}
						>
							<ChevronRightIcon />
						</Button>
					</div>
				</div>
			}
		>
			{cashFlow.isPending && <Skeleton className="m-4 h-40" aria-hidden="true" />}

			{cashFlow.isError && (
				<div role="alert" className="flex flex-col items-start gap-3 p-4">
					<p className="text-muted-foreground">{t(`errors.${errorCodeOf(cashFlow.error)}`)}</p>
					<Button variant="outline" onClick={() => void cashFlow.refetch()}>
						{t("common.retry")}
					</Button>
				</div>
			)}

			{data !== undefined && (
				// The previous month's rows, shown while the next loads, would link
				// to the wrong dates: they stay visible but cannot be clicked.
				<div
					className={cn("flex flex-col", placeholder && "opacity-60")}
					inert={placeholder}
					aria-busy={placeholder}
				>
					<SummaryStrip
						className="border-b border-line"
						cells={[
							{
								label: t("dashboard.cashFlow.income"),
								value: <Money amount={data.income} currency={data.currency} signed plusSign />,
							},
							{
								label: t("dashboard.cashFlow.expenses"),
								value: <Money amount={data.expenses} currency={data.currency} signed />,
							},
							{
								label: t("dashboard.cashFlow.savings"),
								value: (
									<Money
										amount={toMinorUnits(data.income + data.expenses)}
										currency={data.currency}
									/>
								),
							},
						]}
					/>

					{empty ? (
						<p className="p-4 text-sm text-muted-foreground">{t("dashboard.cashFlow.empty")}</p>
					) : lines.length === 0 ? (
						<p className="p-4 text-sm text-muted-foreground">
							{t(`dashboard.cashFlow.emptySide.${side}`)}
						</p>
					) : (
						<div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start">
							<Donut side={side} data={data} lines={lines} />
							<InsetGroup
								level={3}
								title={t(`dashboard.cashFlow.breakdown.${side}`)}
								className="flex-1"
							>
								<ul
									aria-label={t(`dashboard.cashFlow.breakdown.${side}`)}
									className="flex flex-col divide-y divide-line"
								>
									{lines.map((line) => (
										<CategoryRow
											key={line.categoryId ?? UNCATEGORISED}
											line={line}
											side={side}
											data={data}
										/>
									))}
								</ul>
							</InsetGroup>
						</div>
					)}
				</div>
			)}
		</Section>
	);
}
