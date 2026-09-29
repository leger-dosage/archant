import { LandmarkIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";

/** The dashboard of a household without accounts: one way forward, « Ajouter un compte ». */
export function DashboardEmpty({ onAddAccount }: { onAddAccount: () => void }) {
	const { t } = useTranslation();

	return (
		// The dashboard has nothing else to show: the empty state's card is its
		// own region.
		<EmptyState
			labelled
			level={2}
			icon={{ kind: "transfer", icon: LandmarkIcon }}
			title={t("dashboard.empty.title")}
			description={t("dashboard.empty.description")}
			action={<Button onClick={onAddAccount}>{t("accounts.add")}</Button>}
		/>
	);
}
