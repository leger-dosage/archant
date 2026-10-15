import { InfoIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Alert, AlertDescription } from "@/components/ui/alert";

/**
 * Sure's `other_assets` `balance_tracking_info` notice, shown while an other
 * asset is created or edited: only « Ajouter un solde » moves its value.
 */
export function OtherAssetNotice() {
	const { t } = useTranslation();

	// A note, not shadcn's default `alert`: it is read with the form, never
	// announced as it appears. Tinted as Sure's `DS::Alert` `:info`, whose
	// blue is Archant's link colour.
	return (
		<Alert role="note" className="border-link/20 bg-link/10 text-link">
			<InfoIcon aria-hidden="true" />
			<AlertDescription className="text-foreground">
				{t("accounts.form.otherAssetNotice")}
			</AlertDescription>
		</Alert>
	);
}
