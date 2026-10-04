import type { PriceStatusData } from "@/hooks/usePrices";

import { createFileRoute } from "@tanstack/react-router";
import { Loader2Icon, RefreshCwIcon } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Page } from "@/components/Page";
import { Section } from "@/components/Section";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { usePrices, useSetPricesEnabled, useUpdatePrices } from "@/hooks/usePrices";
import { errorCodeOf, isErrorCode } from "@/lib/api";
import { showErrorToast, showFailureToast } from "@/lib/error-toast";

export const Route = createFileRoute("/_authed/settings/investments")({
	component: InvestmentsPage,
});

// Day and time, as a bank's last sync.
const updateTime = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" });

/**
 * The last update and the last run's error, with « Mettre à jour les cours ».
 * A click while this page's run is on is refused as the server would refuse
 * it; while another run holds the lease, such as the first visit of the
 * day's, the button says so.
 */
function UpdateStatus({ status }: { status: PriceStatusData }) {
	const { t } = useTranslation();
	const update = useUpdatePrices();
	const { lastUpdatedAt, lastError, updating } = status;

	const start = () => {
		if (update.isPending) {
			toast.error(t("errors.PRICE_UPDATE_IN_PROGRESS"));
			return;
		}

		update.mutate(undefined, {
			onSuccess: (next) => {
				if (next.lastError === null) {
					toast.success(t("investments.update.done"));
				} else {
					toast.error(t("investments.update.failed"));
				}
			},
			onError: showFailureToast,
		});
	};

	return (
		<div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
			<div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
				<p>
					{lastUpdatedAt === null
						? t("investments.update.never")
						: t("investments.update.last", { when: updateTime.format(new Date(lastUpdatedAt)) })}
				</p>
				{lastError !== null && (
					<p role="status" className="text-destructive">
						{t("investments.update.lastError", {
							error: t(`errors.${isErrorCode(lastError) ? lastError : "INTERNAL_ERROR"}`),
						})}
					</p>
				)}
			</div>
			{updating && !update.isPending ? (
				<Button variant="outline" disabled aria-busy>
					<Loader2Icon className="animate-spin" aria-hidden />
					{t("investments.update.running")}
				</Button>
			) : (
				<Button
					variant="outline"
					onClick={start}
					aria-disabled={update.isPending}
					aria-busy={update.isPending}
				>
					{update.isPending ? (
						<Loader2Icon className="animate-spin" aria-hidden />
					) : (
						<RefreshCwIcon aria-hidden />
					)}
					{t("investments.update.submit")}
				</Button>
			)}
		</div>
	);
}

/**
 * « Réglages › Placements » (AD-22): the switch that lets Archant fetch
 * prices, which says which host it reaches and what that host learns before
 * it is turned on, and, once on, the last update and its button.
 */
function InvestmentsPage() {
	const { t } = useTranslation();
	const prices = usePrices();
	const setEnabled = useSetPricesEnabled();
	const status = prices.data;

	useEffect(() => {
		document.title = t("app.pageTitle", { page: t("investments.title"), app: t("app.name") });
	}, [t]);

	return (
		<Page centred title={t("investments.title")} description={t("investments.description")}>
			<Section title={t("investments.fetch.title")}>
				{prices.isError && (
					<p role="alert" className="p-4 text-muted-foreground">
						{t(`errors.${errorCodeOf(prices.error)}`)}
					</p>
				)}
				{prices.isPending && (
					<div className="p-4">
						<Skeleton className="h-14 w-full" />
					</div>
				)}
				{status !== undefined && (
					<div className="flex flex-col divide-y divide-line">
						<div className="flex items-start gap-3 px-4 py-3">
							<Switch
								id="prices-enabled"
								checked={status.enabled}
								disabled={setEnabled.isPending}
								aria-describedby="prices-disclosure"
								className="mt-0.5"
								onCheckedChange={(enabled) =>
									setEnabled.mutate(enabled, {
										onSuccess: () =>
											toast.success(
												t(enabled ? "investments.fetch.enabled" : "investments.fetch.disabled"),
											),
										onError: (error) => showErrorToast(errorCodeOf(error)),
									})
								}
							/>
							<div className="flex flex-col gap-1">
								<Label htmlFor="prices-enabled">{t("investments.fetch.label")}</Label>
								<div id="prices-disclosure" className="flex flex-col gap-1 text-sm">
									<p className="text-muted-foreground">
										{t("investments.fetch.disclosure", { host: status.host })}
									</p>
									{!status.enabled && (
										<p className="text-muted-foreground">{t("investments.fetch.off")}</p>
									)}
								</div>
							</div>
						</div>
						{status.enabled && <UpdateStatus status={status} />}
					</div>
				)}
			</Section>
		</Page>
	);
}
