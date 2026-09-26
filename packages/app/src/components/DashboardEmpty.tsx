import { LandmarkIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";

/** The dashboard of a household without accounts: one way forward, « Ajouter un compte ». */
export function DashboardEmpty({ onAddAccount }: { onAddAccount: () => void }) {
	const { t } = useTranslation();

	return (
		// No section around it: the dashboard has nothing else to show, so the
		// empty state is its own bordered region.
		<EmptyState
			labelled
			level={2}
			className="rounded-lg border bg-section"
			icon={{ kind: "transfer", icon: LandmarkIcon }}
			title={t("dashboard.empty.title")}
			description={t("dashboard.empty.description")}
			action={<Button onClick={onAddAccount}>{t("accounts.add")}</Button>}
		/>
	);
}
