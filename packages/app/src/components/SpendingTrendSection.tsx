import type { SpendingTrendData } from "@/hooks/useSpendingTrend";

import { Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";

import { toMinorUnits } from "@archant/data/money";

import { DashboardMonthPicker } from "@/components/DashboardMonthPicker";
import { useDashboardWidget } from "@/components/DashboardWidget";
import { Money } from "@/components/Money";
import { Section } from "@/components/Section";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSpendingTrend } from "@/hooks/useSpendingTrend";
import { errorCodeOf } from "@/lib/api";
import { CHART_HEIGHTS, DASHBOARD_FALLBACK_HEIGHT } from "@/lib/chart-heights";
import { capitalised, spendingDelta } from "@/lib/dashboard-months";
import { longDate, monthLabel } from "@/lib/dates";
import { intlLocale } from "@/lib/locale";
import { FLOW_COLOURS } from "@/lib/money-flow";
import { cn } from "@/lib/utils";

const shortMonth = new Intl.DateTimeFormat(intlLocale, { month: "short", timeZone: "UTC" });

/** « sept. » for a day of September 2026, Sure's `%b`. */
const shortMonthOf = (iso: string) => shortMonth.format(new Date(`${iso}T00:00:00Z`));

const dayOf = (iso: string) => Number(iso.slice(8, 10));

const SpendingTrendChart = lazy(async () => ({
	default: (await import("@/components/SpendingTrendChart")).SpendingTrendChart,
}));

/**
 * Sure's `spending_trend`, « Dépenses »: its own month's cumulative spending
 * against the previous month's, the month's total with what it spent beyond
 * the previous one, in the destructive colour, or less, in the income one,
 * and the previous month's total over the same days while the month runs.
 */
export function SpendingTrendSection({
	month,
	onMonthChange,
}: {
	month: string | undefined;
	onMonthChange: (month: string) => void;
}) {
	const { t } = useTranslation();
	const trend = useSpendingTrend(month);
	const data = trend.data;
	const placeholder = trend.isPlaceholderData;

	return (
		<Section title={t("dashboard.spendingTrend.title")}>
			{trend.isPending && <Skeleton className="m-4 h-72" aria-hidden="true" />}

			{trend.isError && (
				<div role="alert" className="flex flex-col items-start gap-3 p-4">
					<p className="text-muted-foreground">{t(`errors.${errorCodeOf(trend.error)}`)}</p>
					<Button variant="outline" onClick={() => void trend.refetch()}>
						{t("common.retry")}
					</Button>
				</div>
			)}

			{data !== undefined && (
				<SpendingTrend data={data} placeholder={placeholder} onMonthChange={onMonthChange} />
			)}
		</Section>
	);
}

function SpendingTrend({
	data,
	placeholder,
	onMonthChange,
}: {
	data: SpendingTrendData;
	placeholder: boolean;
	onMonthChange: (month: string) => void;
}) {
	const { t } = useTranslation();
	const height = CHART_HEIGHTS[useDashboardWidget()?.heightPx ?? DASHBOARD_FALLBACK_HEIGHT];
	const delta = spendingDelta(data.currentTotal, data.previousTotal);
	const hasData = [...data.current, ...data.previous].some((point) => point.amount < 0);
	const current = capitalised(monthLabel(data.month));
	const previous = capitalised(monthLabel(data.previousMonth));

	return (
		<div
			className={cn("flex flex-col gap-4 p-4", placeholder && "opacity-60")}
			inert={placeholder}
			aria-busy={placeholder}
		>
			<div className="flex items-center justify-between gap-3">
				<p className="hidden text-sm text-muted-foreground sm:block">
					{t("dashboard.spendingTrend.dateRange", {
						startDate: longDate(data.from),
						endDate: longDate(data.to),
					})}
				</p>
				{/* Sure's `date_range_short`: the range never spans months, so the end needs its day alone. */}
				<p className="text-sm text-muted-foreground sm:hidden">
					{data.from === data.to
						? t("dashboard.spendingTrend.dateRangeShortSingle", {
								day: dayOf(data.from),
								month: shortMonthOf(data.from),
								year: data.from.slice(0, 4),
							})
						: t("dashboard.spendingTrend.dateRangeShort", {
								startDay: dayOf(data.from),
								endDay: dayOf(data.to),
								month: shortMonthOf(data.from),
								year: data.to.slice(0, 4),
							})}
				</p>
				<DashboardMonthPicker
					month={data.month}
					hint={t("dashboard.spendingTrend.periodScopeHint")}
					onPick={onMonthChange}
				/>
			</div>

			<div className="flex items-center justify-between gap-4">
				<div role="group" aria-label={current} className="flex min-w-0 items-center gap-3">
					<span
						aria-hidden="true"
						className="h-10 w-1 shrink-0 rounded-full"
						style={{ backgroundColor: FLOW_COLOURS.income }}
					/>
					<div className="min-w-0">
						<p className="truncate text-sm">{current}</p>
						<p className="flex flex-wrap items-baseline gap-x-2">
							<Money
								amount={toMinorUnits(Math.abs(data.currentTotal))}
								currency={data.currency}
								className="text-lg"
							/>
							<Money
								amount={delta}
								currency={data.currency}
								className={cn(
									"text-sm font-normal",
									delta < 0 && "text-money-income",
									delta === 0 && "text-muted-foreground",
									delta > 0 && "text-destructive",
								)}
							/>
						</p>
					</div>
				</div>

				<div role="group" aria-label={previous} className="flex min-w-0 items-center gap-3">
					<span
						aria-hidden="true"
						className="h-10 w-1 shrink-0 rounded-full"
						style={{ backgroundColor: FLOW_COLOURS.muted }}
					/>
					<div className="min-w-0">
						<p className="truncate text-sm text-muted-foreground">
							{previous}
							{data.previousComparisonDay !== null && (
								<span className="ml-1 text-xs">
									{t("dashboard.spendingTrend.previousComparisonDays", {
										endDay: data.previousComparisonDay,
									})}
								</span>
							)}
						</p>
						<Money
							amount={toMinorUnits(Math.abs(data.previousTotal))}
							currency={data.currency}
							className="text-lg text-muted-foreground"
						/>
					</div>
				</div>
			</div>

			{hasData ? (
				<Suspense fallback={<div className={height} />}>
					<SpendingTrendChart data={data} labels={{ current, previous }} className={height} />
				</Suspense>
			) : (
				<div className={cn("flex items-center justify-center", height)}>
					<p className="text-sm text-muted-foreground">{t("dashboard.spendingTrend.noData")}</p>
				</div>
			)}
		</div>
	);
}
