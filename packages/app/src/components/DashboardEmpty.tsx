import { LandmarkIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { TintedIcon } from "@/components/TintedIcon";
import { Button } from "@/components/ui/button";

/** The dashboard of a household without accounts: one way forward, « Ajouter un compte ». */
export function DashboardEmpty({ onAddAccount }: { onAddAccount: () => void }) {
	const { t } = useTranslation();

	return (
		<section
			aria-labelledby="dashboard-empty-heading"
			className="flex flex-col items-center gap-3 rounded-lg border bg-section px-6 py-10 text-center"
		>
			<TintedIcon subject={{ kind: "transfer", icon: LandmarkIcon }} size="lg" />
			<h2 id="dashboard-empty-heading" className="type-title">
				{t("dashboard.empty.title")}
			</h2>
			<p className="max-w-sm text-muted-foreground">{t("dashboard.empty.description")}</p>
			<Button onClick={onAddAccount}>{t("accounts.add")}</Button>
		</section>
	);
}
