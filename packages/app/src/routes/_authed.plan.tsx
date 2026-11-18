import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { Page } from "@/components/Page";
import { PlanBudget } from "@/components/PlanBudget";
import { PlanGoals } from "@/components/PlanGoals";

export const Route = createFileRoute("/_authed/plan")({ component: PlanPage });

function PlanPage() {
	const { t } = useTranslation();

	useEffect(() => {
		document.title = t("app.pageTitle", { page: t("nav.plan"), app: t("app.name") });
	}, [t]);

	return (
		<Page title={t("nav.plan")} description={t("plan.description")} className="@container">
			<div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2">
				<PlanBudget />
				<PlanGoals />
			</div>
		</Page>
	);
}
