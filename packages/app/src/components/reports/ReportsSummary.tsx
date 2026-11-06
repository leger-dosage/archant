import type { ReportsPageData } from "@/hooks/useReportsPage";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import {
	ArrowDownIcon,
	ArrowUpIcon,
	GaugeIcon,
	PiggyBankIcon,
	TrendingDownIcon,
	TrendingUpIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Money } from "@/components/Money";
import { formatChangePercent, formatTenthPercent } from "@/lib/percent";
import { cn } from "@/lib/utils";

function Card({
	icon: Icon,
	title,
	children,
}: {
	icon: LucideIcon;
	title: string;
	children: ReactNode;
}) {
	return (
		<div
			role="group"
			aria-label={title}
			className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-6"
		>
			<div className="flex items-center gap-2">
				<Icon aria-hidden="true" className="size-4 text-muted-foreground" />
				<h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
			</div>
			<div className="flex flex-col gap-2">{children}</div>
		</div>
	);
}

/**
 * Sure's change line: up or down against the comparison period, green when
 * it is good news, so an expense that grew reads red.
 */
function Change({ percent, inverted }: { percent: number; inverted: boolean }) {
	const { t } = useTranslation();
	const up = percent >= 0;
	const good = up !== inverted;
	const Icon = up ? ArrowUpIcon : ArrowDownIcon;

	return (
		<p className="flex flex-wrap items-center gap-1.5 text-sm">
			<Icon
				aria-hidden="true"
				className={cn("size-4", good ? "text-trend-up" : "text-destructive")}
			/>
			<span className={cn("font-medium", good ? "text-trend-up" : "text-destructive")}>
				{formatChangePercent(percent)}
			</span>
			<span className="text-muted-foreground">{t("reports.summary.vsPrevious")}</span>
		</p>
	);
}

/** The bar's fill, 0 to 100: refunds above spending read below zero. */
const barPercent = (percent: number) => Math.min(Math.max(percent, 0), 100);

/** Sure's bar: red from 100 %, orange from 80 %, green below. */
function budgetTone(percent: number): string {
	return percent >= 100 ? "bg-destructive" : percent >= 80 ? "bg-warning" : "bg-trend-up";
}

/**
 * Sure's `_summary_dashboard`, fixed above the sections: income and expenses
 * with their change, the net savings, and the budget's use this month.
 */
export function ReportsSummary({ data }: { data: Pick<ReportsPageData, "summary" | "currency"> }) {
	const { t } = useTranslation();
	const { summary, currency } = data;

	return (
		<section
			aria-label={t("reports.summary.label")}
			className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"
		>
			<Card icon={TrendingUpIcon} title={t("reports.summary.totalIncome")}>
				<Money amount={summary.income} currency={currency} className="text-2xl font-semibold" />
				<Change percent={summary.incomeChange} inverted={false} />
			</Card>
			<Card icon={TrendingDownIcon} title={t("reports.summary.totalExpenses")}>
				<Money amount={summary.expenses} currency={currency} className="text-2xl font-semibold" />
				<Change percent={summary.expenseChange} inverted />
			</Card>
			<Card icon={PiggyBankIcon} title={t("reports.summary.netSavings")}>
				<Money
					amount={summary.netSavings}
					currency={currency}
					className={cn(
						"text-2xl font-semibold",
						summary.netSavings >= 0 ? "text-trend-up" : "text-destructive",
					)}
				/>
				<p className="text-sm text-muted-foreground">{t("reports.summary.incomeMinusExpenses")}</p>
			</Card>
			<Card icon={GaugeIcon} title={t("reports.summary.budgetPerformance")}>
				{summary.budgetPercent === null ? (
					<p className="text-muted-foreground">{t("reports.summary.noBudgetData")}</p>
				) : (
					<>
						<p className="text-2xl font-semibold tabular-nums">
							{formatTenthPercent(summary.budgetPercent)}
						</p>
						<div className="flex flex-col gap-1.5">
							<div
								role="progressbar"
								aria-label={t("reports.summary.budgetPerformance")}
								aria-valuemin={0}
								aria-valuemax={100}
								aria-valuenow={barPercent(summary.budgetPercent)}
								className="h-2 overflow-hidden rounded-full bg-inset"
							>
								<div
									className={cn("h-full rounded-full", budgetTone(summary.budgetPercent))}
									style={{ width: `${barPercent(summary.budgetPercent)}%` }}
								/>
							</div>
							<p className="text-sm text-muted-foreground">{t("reports.summary.ofBudgetUsed")}</p>
						</div>
					</>
				)}
			</Card>
		</section>
	);
}
