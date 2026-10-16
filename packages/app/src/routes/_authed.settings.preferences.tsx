import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { AccountOrder } from "@archant/data/account-orders";
import { ACCOUNT_ORDERS } from "@archant/data/account-orders";

import { ChoiceField } from "@/components/ChoiceField";
import { Page } from "@/components/Page";
import { Section } from "@/components/Section";
import { Skeleton } from "@/components/ui/skeleton";
import { usePreferences, useUpdatePreferences } from "@/hooks/usePreferences";
import { errorCodeOf } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";

export const Route = createFileRoute("/_authed/settings/preferences")({
	component: PreferencesPage,
});

/**
 * « Réglages › Préférences », Sure's `settings/preferences/show`: its
 * « Général » section with the account order alone, the other fields
 * belonging to later stories. The select saves on change, as Sure's
 * `auto-submit-form`, and every account list follows.
 */
function PreferencesPage() {
	const { t } = useTranslation();
	const preferences = usePreferences();
	const update = useUpdatePreferences();

	useEffect(() => {
		document.title = t("app.pageTitle", { page: t("preferences.title"), app: t("app.name") });
	}, [t]);

	const options = ACCOUNT_ORDERS.map((order) => ({
		value: order,
		label: t(`preferences.accountOrders.${order}`),
	}));

	const save = (defaultAccountOrder: AccountOrder) =>
		update.mutate(
			{ defaultAccountOrder },
			{
				onSuccess: () => toast.success(t("preferences.saved")),
				onError: (error) => showErrorToast(errorCodeOf(error)),
			},
		);

	return (
		<Page centred title={t("preferences.title")}>
			<Section title={t("preferences.general.title")}>
				<div className="flex flex-col gap-4 p-4">
					<p className="text-sm text-muted-foreground">{t("preferences.general.subtitle")}</p>
					{preferences.isError && (
						<p role="alert" className="text-muted-foreground">
							{t(`errors.${errorCodeOf(preferences.error)}`)}
						</p>
					)}
					{preferences.isPending && <Skeleton className="h-14 w-full" />}
					{preferences.data !== undefined && (
						<ChoiceField
							id="default-account-order"
							label={t("preferences.general.defaultAccountOrder")}
							value={preferences.data.defaultAccountOrder}
							options={options}
							disabled={update.isPending}
							onChange={save}
						/>
					)}
				</div>
			</Section>
		</Page>
	);
}
