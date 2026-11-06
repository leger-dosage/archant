import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { ReportPrint } from "@/components/reports/ReportPrint";
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

	if (report.data !== undefined) {
		return <ReportPrint data={report.data} />;
	}

	return (
		<main className="grid min-h-svh place-items-center p-6 text-muted-foreground">
			<p role={report.isError ? "alert" : "status"}>
				{report.isError ? t(`errors.${errorCodeOf(report.error)}`) : t("reports.print.loading")}
			</p>
		</main>
	);
}
