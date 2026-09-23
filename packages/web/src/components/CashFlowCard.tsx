import type { CashFlowData, CashFlowLine } from "@/hooks/useCashFlow";

import { Link } from "@tanstack/react-router";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { UNCATEGORISED } from "@archant/api/schemas/transactions";

import { CategoryDot } from "@/components/CategoryDot";
import { Money } from "@/components/Money";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCashFlow } from "@/hooks/useCashFlow";
import { errorCodeOf } from "@/lib/api";
import { addMonthsTo, monthHeading } from "@/lib/dates";
import { cn } from "@/lib/utils";

const shareFormat = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 0 });

function CategoryRow({
	line,
	side,
	largest,
	data,
}: {
	line: CashFlowLine;
	side: "income" | "expense";
	largest: number;
	data: CashFlowData;
}) {
	const { t } = useTranslation();
	const width = largest === 0 ? 0 : (Math.abs(line.amount) / largest) * 100;

	return (
		<li>
			<Link
				to="/operations"
				search={{
					category: [line.categoryId ?? UNCATEGORISED],
					// « Sans catégorie » sits on both sides: its list keeps this side's rows.
					...(line.categoryId === null ? { direction: [side] } : {}),
					from: data.from,
					to: data.to,
				}}
				className="grid grid-cols-[auto_minmax(0,10rem)_1fr_3rem_auto] items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
			>
				<CategoryDot color={line.color} />
				<span className="truncate">{line.name ?? t("dashboard.cashFlow.uncategorised")}</span>
				<span aria-hidden="true" className="h-1.5 rounded-full bg-muted">
					<span
						className="block h-full rounded-full bg-muted-foreground"
						style={{
							width: `${width}%`,
							...(line.color === null ? {} : { backgroundColor: line.color }),
						}}
					/>
				</span>
				<span className="text-right text-xs text-muted-foreground tabular-nums">
					{line.share === null ? "" : shareFormat.format(line.share).replace("-", "−")}
				</span>
				<Money amount={line.amount} currency={data.currency} className="text-right" />
			</Link>
		</li>
	);
}

/** One side of the month: its label, its signed total, then its category rows. */
function FlowGroup({
	label,
	side,
	total,
	lines,
	data,
}: {
	label: string;
	side: "income" | "expense";
	total: CashFlowData["income"];
	lines: CashFlowLine[];
	data: CashFlowData;
}) {
	const largest = Math.max(0, ...lines.map((line) => Math.abs(line.amount)));

	return (
		<div role="group" aria-label={label} className="flex min-w-0 flex-col gap-3">
			<div className="flex flex-col gap-0.5">
				<span className="text-xs text-muted-foreground">{label}</span>
				<Money amount={total} currency={data.currency} signed className="text-xl" />
			</div>
			{lines.length > 0 && (
				<ul className="flex flex-col">
					{lines.map((line) => (
						<CategoryRow
							key={line.categoryId ?? UNCATEGORISED}
							line={line}
							side={side}
							largest={largest}
							data={data}
						/>
					))}
				</ul>
			)}
		</div>
	);
}

/**
 * « Ce mois-ci »: a month's income and expenses, each with one row per
 * top-level category that opens its transactions. `current` is this month in
 * the browser's zone: its heading reads « Ce mois-ci » and nothing lies after it.
 */
export function CashFlowCard({
	month,
	current,
	onMonthChange,
}: {
	month: string;
	current: string;
	onMonthChange: (month: string) => void;
}) {
	const { t } = useTranslation();
	const cashFlow = useCashFlow(month);
	const data = cashFlow.data;
	const placeholder = cashFlow.isPlaceholderData;
	const empty =
		data !== undefined && data.lines.income.length === 0 && data.lines.expense.length === 0;

	return (
		<section
			aria-labelledby="cash-flow-heading"
			className="flex flex-col gap-4 rounded-lg border p-6"
		>
			<div className="flex items-center justify-between gap-4">
				<h2 id="cash-flow-heading" className="text-lg font-semibold">
					{month === current ? t("dashboard.cashFlow.thisMonth") : monthHeading(month)}
				</h2>
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

			{cashFlow.isPending && <Skeleton className="h-40 w-full" aria-hidden="true" />}

			{cashFlow.isError && (
				<div role="alert" className="flex flex-col items-start gap-3">
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
					className={cn("grid gap-8 md:grid-cols-2", placeholder && "opacity-60")}
					inert={placeholder}
					aria-busy={placeholder}
				>
					<FlowGroup
						label={t("dashboard.cashFlow.income")}
						side="income"
						total={data.income}
						lines={data.lines.income}
						data={data}
					/>
					<FlowGroup
						label={t("dashboard.cashFlow.expenses")}
						side="expense"
						total={data.expenses}
						lines={data.lines.expense}
						data={data}
					/>
				</div>
			)}

			{empty && <p className="text-sm text-muted-foreground">{t("dashboard.cashFlow.empty")}</p>}
		</section>
	);
}
