import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { DEFAULT_BIGGEST_EXPENSES_LIMIT } from "@archant/data/reports-sections";

import { ReportPrint } from "@/components/reports/ReportPrint";
import { useCanWrite } from "@/hooks/usePermissions";
import { useReportsLayout } from "@/hooks/useReportsLayout";
import { useReportsPage } from "@/hooks/useReportsPage";
import { errorCodeOf } from "@/lib/api";
import { reportsSearchSchema, settledSearch } from "@/lib/reports";

/**
 * Sure's `reports/print`, in a tab of its own: no shell around it, the same
 * read as the page, so the two never disagree.
 */
export const Route = createFileRoute("/_authed/reports_/print")({
	validateSearch: reportsSearchSchema,
	staticData: { bare: true },
	component: ReportPrintPage,
});

function ReportPrintPage() {
	const { t } = useTranslation();
	const report = useReportsPage(settledSearch(Route.useSearch()));
	const canWrite = useCanWrite();
	const layout = useReportsLayout({ enabled: canWrite });
	const error = report.error ?? (canWrite ? layout.error : null);

	if (report.data !== undefined && (!canWrite || layout.data !== undefined)) {
		return (
			<ReportPrint
				data={report.data}
				biggestExpensesLimit={layout.data?.biggestExpensesLimit ?? DEFAULT_BIGGEST_EXPENSES_LIMIT}
			/>
		);
	}

	return (
		<main className="grid min-h-svh place-items-center p-6 text-muted-foreground">
			<p role={error === null ? "status" : "alert"}>
				{error === null ? t("reports.print.loading") : t(`errors.${errorCodeOf(error)}`)}
			</p>
		</main>
	);
}
