import type { ReportsLayoutData } from "@/hooks/useReportsLayout";
import type { ReportsPageData } from "@/hooks/useReportsPage";
import type { ReactNode } from "react";

import { Link, createFileRoute } from "@tanstack/react-router";
import { PrinterIcon } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { resolveReportsLayout } from "@archant/data/reports-layout";
import type { ReportsSection as ReportsSectionKey } from "@archant/data/reports-sections";

import { useDashboardSortable } from "@/components/DashboardWidget";
import { Page } from "@/components/Page";
import { ActivityBreakdown } from "@/components/reports/ActivityBreakdown";
import { BiggestExpenses, BiggestExpensesLimitControl } from "@/components/reports/BiggestExpenses";
import { InvestmentFlows } from "@/components/reports/InvestmentFlows";
import { InvestmentPerformance } from "@/components/reports/InvestmentPerformance";
import { ReportsEmptyState } from "@/components/reports/ReportsEmptyState";
import { ReportsNetWorth } from "@/components/reports/ReportsNetWorth";
import { ReportsPeriodControls } from "@/components/reports/ReportsPeriodControls";
import { ReportsSection } from "@/components/reports/ReportsSection";
import { ReportsSummary } from "@/components/reports/ReportsSummary";
import { ReportsTagFilter } from "@/components/reports/ReportsTagFilter";
import { TrendsSection } from "@/components/reports/TrendsSection";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCanWrite } from "@/hooks/usePermissions";
import { useReportsLayout, useUpdateReportsLayout } from "@/hooks/useReportsLayout";
import { useReportsPage } from "@/hooks/useReportsPage";
import { errorCodeOf } from "@/lib/api";
import { reportsSearchSchema, settledSearch } from "@/lib/reports";

/** Sure's default order with nothing collapsed: what a guest sees (AD-21). */
const DEFAULT_LAYOUT: ReportsLayoutData = resolveReportsLayout(null);

export const Route = createFileRoute("/_authed/reports")({
	validateSearch: reportsSearchSchema,
	component: ReportsPage,
});

/** The period the page shows, its dates written out, as the CSV and the print layout read it. */
function periodSearch({ period, tag }: ReportsPageData) {
	return { periodType: period.type, startDate: period.from, endDate: period.to, tag };
}

function exportHref(data: ReportsPageData) {
	const { tag, ...period } = periodSearch(data);
	const query = new URLSearchParams(period);
	tag?.forEach((id) => query.append("tag", id));

	return `/api/reports/export?${query}`;
}

function ReportsPage() {
	const { t } = useTranslation();
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	const report = useReportsPage(settledSearch(search));
	const canWrite = useCanWrite();
	const savedLayout = useReportsLayout({ enabled: canWrite });
	const updateLayout = useUpdateReportsLayout();
	const layout = (canWrite ? savedLayout.data : undefined) ?? DEFAULT_LAYOUT;
	const layoutReady = !canWrite || !savedLayout.isPending;
	const { order, sortable } = useDashboardSortable<ReportsSectionKey>(
		layout.sectionOrder,
		(sectionOrder) => {
			if (canWrite) {
				updateLayout.mutate({ sectionOrder });
			}
		},
		{ drop: "midpoint" },
	);
	const data = report.data;

	useEffect(() => {
		document.title = t("app.pageTitle", { page: t("reports.title"), app: t("app.name") });
	}, [t]);

	const sections = (page: ReportsPageData): Record<ReportsSectionKey, ReactNode> => ({
		trends_insights: <TrendsSection data={page} />,
		transactions_breakdown: <ActivityBreakdown data={page} csvHref={exportHref(page)} />,
		net_worth: <ReportsNetWorth data={page} />,
		investment_performance: <InvestmentPerformance data={page} />,
		investment_flows: <InvestmentFlows data={page} />,
		biggest_expenses: <BiggestExpenses data={page} limit={layout.biggestExpensesLimit} />,
	});

	return (
		<Page
			title={t("reports.title")}
			description={t("reports.subtitle")}
			actions={
				data === undefined ? undefined : (
					<Button variant="outline" asChild>
						{/* Sure's print layout, in a tab of its own that prints itself. */}
						<Link
							to="/reports/print"
							search={periodSearch(data)}
							target="_blank"
							rel="noopener"
							aria-label={t("reports.printReport")}
						>
							<PrinterIcon aria-hidden="true" />
							<span className="hidden sm:inline">{t("reports.printReport")}</span>
						</Link>
					</Button>
				)
			}
		>
			<div className="mb-4">
				<ReportsTagFilter
					selected={search.tag}
					onApply={(tag) => void navigate({ search: (previous) => ({ ...previous, tag }) })}
				/>
			</div>
			{report.isPending && <Skeleton className="h-96 w-full rounded-xl" aria-hidden="true" />}

			{report.isError && (
				<div role="alert" className="flex flex-col items-start gap-3 rounded-xl border p-8">
					<p className="text-muted-foreground">{t(`errors.${errorCodeOf(report.error)}`)}</p>
					<Button variant="outline" onClick={() => void report.refetch()}>
						{t("common.retry")}
					</Button>
				</div>
			)}

			{data !== undefined && (
				<div className="flex flex-col gap-6">
					{data.period.swapped && (
						<p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
							{t("reports.invalidDateRange")}
						</p>
					)}
					<ReportsPeriodControls
						data={data}
						hotkeysOff={sortable.grabbed !== null}
						onCustomRange={(startDate, endDate) =>
							void navigate({
								search: ({ tag }) => ({ periodType: "custom", startDate, endDate, tag }),
							})
						}
					/>
					{data.hasTransactions || data.investments.available ? (
						<>
							<ReportsSummary data={data} />
							{data.hasAccounts && !layoutReady && (
								<Skeleton className="h-96 w-full rounded-xl" aria-hidden="true" />
							)}
							{data.hasAccounts && layoutReady && (
								<div
									role="list"
									aria-label={t("reports.sections")}
									className="flex flex-col gap-6"
									onDragOver={(event) => {
										if (sortable.dragging()) {
											event.preventDefault();
											event.dataTransfer.dropEffect = "move";
											sortable.over(event.clientX, event.clientY);
										}
									}}
									onDrop={(event) => {
										if (sortable.dragging()) {
											event.preventDefault();
											sortable.drop(event.clientX, event.clientY);
										}
									}}
								>
									{order
										.filter((key) => {
											switch (key) {
												case "investment_performance":
													return data.investments.available;
												case "investment_flows":
													return data.investmentFlows.available;
												case "biggest_expenses":
													return data.biggestExpenses.length > 0;
												default:
													return true;
											}
										})
										.map((key) => (
											<ReportsSection
												key={key}
												sectionKey={key}
												collapsed={layout.collapsedSections[key]}
												editable={canWrite}
												action={
													canWrite &&
													key === "biggest_expenses" && (
														<BiggestExpensesLimitControl
															limit={layout.biggestExpensesLimit}
															onChange={(biggestExpensesLimit) =>
																updateLayout.mutate({ biggestExpensesLimit })
															}
														/>
													)
												}
												sortable={sortable}
												onToggle={() =>
													updateLayout.mutate({
														collapsedSections: { [key]: !layout.collapsedSections[key] },
													})
												}
											>
												{sections(data)[key]}
											</ReportsSection>
										))}
									{sortable.dropAtEnd && (
										<span aria-hidden="true" className="-mt-4 h-1 rounded-full bg-primary" />
									)}
								</div>
							)}
						</>
					) : (
						<ReportsEmptyState />
					)}
				</div>
			)}
		</Page>
	);
}
