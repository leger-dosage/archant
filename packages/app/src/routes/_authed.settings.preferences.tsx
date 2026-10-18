import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { PreferencesInput } from "@archant/api/schemas/preferences";
import type { AccountOrder } from "@archant/data/account-orders";
import { ACCOUNT_ORDERS } from "@archant/data/account-orders";

import { ChoiceField } from "@/components/ChoiceField";
import { Page } from "@/components/Page";
import { Section } from "@/components/Section";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { usePreferences, useUpdatePreferences } from "@/hooks/usePreferences";
import { errorCodeOf } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";

export const Route = createFileRoute("/_authed/settings/preferences")({
	component: PreferencesPage,
});

/**
 * « Réglages › Préférences », Sure's `settings/preferences/show`: its
 * « Général » section with the account order alone, the other fields
 * belonging to later stories, then the « Transactions » section of Sure's
 * `settings/appearances/show`, Archant having no « Apparence » page. Each
 * control saves on change, as Sure's `auto-submit-form`, and every list
 * follows.
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

	const save = (input: PreferencesInput) =>
		update.mutate(input, {
			onSuccess: () => toast.success(t("preferences.saved")),
			onError: (error) => showErrorToast(errorCodeOf(error)),
		});

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
							onChange={(defaultAccountOrder: AccountOrder) => save({ defaultAccountOrder })}
						/>
					)}
				</div>
			</Section>
			<Section title={t("preferences.transactions.title")}>
				<div className="flex flex-col gap-4 p-4">
					<p className="text-sm text-muted-foreground">{t("preferences.transactions.subtitle")}</p>
					{preferences.isPending && <Skeleton className="h-14 w-full" />}
					{preferences.data !== undefined && (
						<div className="flex items-center justify-between gap-4">
							<div className="flex flex-col gap-1 text-sm">
								<Label htmlFor="show-split-grouped">
									{t("preferences.transactions.splitGrouped")}
								</Label>
								<p id="show-split-grouped-description" className="text-muted-foreground">
									{t("preferences.transactions.splitGroupedDescription")}
								</p>
							</div>
							<Switch
								id="show-split-grouped"
								aria-describedby="show-split-grouped-description"
								checked={preferences.data.showSplitGrouped}
								disabled={update.isPending}
								onCheckedChange={(showSplitGrouped) => save({ showSplitGrouped })}
							/>
						</div>
					)}
				</div>
			</Section>
		</Page>
	);
}
