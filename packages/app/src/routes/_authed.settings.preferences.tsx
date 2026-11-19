import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { HouseholdPreferencesInput } from "@archant/api/schemas/household-preferences";
import type { PreferencesInput } from "@archant/api/schemas/preferences";
import type { AccountOrder } from "@archant/data/account-orders";
import { ACCOUNT_ORDERS } from "@archant/data/account-orders";
import type { Locale } from "@archant/data/locales";
import { LOCALES } from "@archant/data/locales";

import { ChoiceField } from "@/components/ChoiceField";
import { Page } from "@/components/Page";
import { Section } from "@/components/Section";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
	useHouseholdPreferences,
	useUpdateHouseholdPreferences,
} from "@/hooks/useHouseholdPreferences";
import { useIsAdmin } from "@/hooks/usePermissions";
import { usePreferences, useUpdatePreferences } from "@/hooks/usePreferences";
import { errorCodeOf } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";
import {
	countryOptions,
	currencyLabel,
	dateFormatOptions,
	timeZoneOptions,
} from "@/lib/household-preferences";

export const Route = createFileRoute("/_authed/settings/preferences")({
	component: PreferencesPage,
});

const monthStartOptions = Array.from({ length: 28 }, (_, index) => {
	const day = String(index + 1);

	return { value: day, label: day };
});

function PreferencesPage() {
	const { t } = useTranslation();
	const preferences = usePreferences();
	const household = useHouseholdPreferences();
	const updateHousehold = useUpdateHouseholdPreferences();
	const update = useUpdatePreferences();
	const admin = useIsAdmin();

	useEffect(() => {
		document.title = t("app.pageTitle", { page: t("preferences.title"), app: t("app.name") });
	}, [t]);

	const options = ACCOUNT_ORDERS.map((order) => ({
		value: order,
		label: t(`preferences.accountOrders.${order}`),
	}));

	// « Langue du navigateur » is the empty choice, Sure's blank `locale`.
	const localeOptions: { value: Locale | "browser"; label: string }[] = [
		{ value: "browser", label: t("preferences.locales.browser") },
		...LOCALES.map((locale) => ({ value: locale, label: t(`preferences.locales.${locale}`) })),
	];

	const save = (input: PreferencesInput) =>
		update.mutate(input, {
			onSuccess: () => toast.success(t("preferences.saved")),
			onError: (error) => showErrorToast(errorCodeOf(error)),
		});

	const saveHousehold = (input: HouseholdPreferencesInput) =>
		updateHousehold.mutate(input, {
			onSuccess: () => toast.success(t("preferences.householdSaved")),
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
						<>
							<ChoiceField
								id="locale"
								label={t("preferences.general.locale")}
								value={preferences.data.locale ?? "browser"}
								options={localeOptions}
								disabled={update.isPending}
								onChange={(choice: Locale | "browser") =>
									save({ locale: choice === "browser" ? null : choice })
								}
							/>
							{admin && (
								<ChoiceField
									id="household-locale"
									label={t("preferences.general.householdLocale")}
									description={t("preferences.general.householdLocaleHint")}
									value={preferences.data.householdLocale}
									options={LOCALES.map((locale) => ({
										value: locale,
										label: t(`preferences.locales.${locale}`),
									}))}
									disabled={update.isPending}
									onChange={(householdLocale: Locale) => save({ householdLocale })}
								/>
							)}
							<ChoiceField
								id="default-account-order"
								label={t("preferences.general.defaultAccountOrder")}
								value={preferences.data.defaultAccountOrder}
								options={options}
								disabled={update.isPending}
								onChange={(defaultAccountOrder: AccountOrder) => save({ defaultAccountOrder })}
							/>
						</>
					)}
					{admin && household.isError && (
						<p role="alert" className="text-muted-foreground">
							{t(`errors.${errorCodeOf(household.error)}`)}
						</p>
					)}
					{admin && household.isPending && <Skeleton className="h-14 w-full" />}
					{admin && household.data !== undefined && (
						<>
							<ChoiceField
								id="household-time-zone"
								label={t("preferences.general.timeZone")}
								value={household.data.timeZone}
								options={timeZoneOptions(household.data.timeZone)}
								disabled={updateHousehold.isPending}
								onChange={(timeZone) => saveHousehold({ timeZone })}
							/>
							<ChoiceField
								id="household-date-format"
								label={t("preferences.general.dateFormat")}
								value={household.data.dateFormat}
								options={dateFormatOptions}
								disabled={updateHousehold.isPending}
								onChange={(dateFormat) => saveHousehold({ dateFormat })}
							/>
							<ChoiceField
								id="household-country"
								label={t("preferences.general.country")}
								value={household.data.country}
								options={countryOptions}
								disabled={updateHousehold.isPending}
								onChange={(country) => saveHousehold({ country })}
							/>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="household-currency">{t("preferences.general.baseCurrency")}</Label>
								<Input
									id="household-currency"
									readOnly
									value={currencyLabel(household.data.baseCurrency)}
								/>
							</div>
						</>
					)}
				</div>
			</Section>
			{admin && household.data !== undefined && (
				<Section title={t("preferences.budget.title")}>
					<div className="p-4">
						<ChoiceField
							id="household-month-start"
							label={t("preferences.budget.monthStartDay")}
							description={t("preferences.budget.monthStartDayHint")}
							value={String(household.data.monthStartDay)}
							options={monthStartOptions}
							disabled={updateHousehold.isPending}
							onChange={(day) => saveHousehold({ monthStartDay: Number(day) })}
						/>
					</div>
				</Section>
			)}
			{admin && preferences.data !== undefined && (
				<Section title={t("sharing.settings")}>
					<div className="flex flex-col gap-4 p-4">
						<ChoiceField
							id="default-account-sharing"
							label={t("sharing.defaultAccount")}
							value={preferences.data.defaultAccountSharing}
							options={[
								{ value: "shared", label: t("sharing.sharedByDefault") },
								{ value: "private", label: t("sharing.privateByDefault") },
							]}
							disabled={update.isPending}
							onChange={(defaultAccountSharing) => save({ defaultAccountSharing })}
						/>
						<div className="flex items-center justify-between gap-4">
							<Label htmlFor="personal-budgets">{t("sharing.personalBudgets")}</Label>
							<Switch
								id="personal-budgets"
								checked={preferences.data.personalBudgets}
								disabled={update.isPending}
								onCheckedChange={(personalBudgets) => save({ personalBudgets })}
							/>
						</div>
					</div>
				</Section>
			)}
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
					{admin && preferences.data !== undefined && (
						<div className="flex items-center justify-between gap-4">
							<div className="flex flex-col gap-1 text-sm">
								<Label htmlFor="manual-reconciliation">
									{t("transactions.reconciliation.setting")}
								</Label>
								<p id="manual-reconciliation-description" className="text-muted-foreground">
									{t("transactions.reconciliation.settingDescription")}
								</p>
							</div>
							<Switch
								id="manual-reconciliation"
								aria-describedby="manual-reconciliation-description"
								checked={preferences.data.manualReconciliation}
								disabled={update.isPending}
								onCheckedChange={(manualReconciliation) => save({ manualReconciliation })}
							/>
						</div>
					)}
				</div>
			</Section>
		</Page>
	);
}
