import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Page } from "@/components/Page";
import { RecurringSuggestions } from "@/components/RecurringSuggestions";
import { Section } from "@/components/Section";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import {
	recurringSettingsQuery,
	useCleanupRecurring,
	useDetectRecurring,
	useRecurring,
	useSaveRecurringSettings,
} from "@/hooks/useRecurring";
import { errorCodeOf } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";

export const Route = createFileRoute("/_authed/settings/recurring")({
	component: RecurringSettingsPage,
});

// When the recurring work runs, as the server runs it: Sure's triggers, in Archant's terms.
const TRIGGERS = ["import", "sync", "daily"] as const;

/**
 * Sure's `recurring_transactions#index`: « Activer les transactions
 * récurrentes », then, while it is on, what detection does and when it runs,
 * the possible bills it found, « Identifier les modèles » and « Nettoyer les
 * obsolètes », and the way to every bill. The settings layout keeps a viewer
 * off this page; the switch would show them its state, disabled.
 */
function RecurringSettingsPage() {
	const { t } = useTranslation();
	const admin = useIsAdmin();
	const settings = useQuery(recurringSettingsQuery);
	const save = useSaveRecurringSettings();
	const enabled = settings.data?.enabled;
	const recurring = useRecurring();
	const detect = useDetectRecurring();
	const cleanup = useCleanupRecurring();
	const suggestions = (recurring.data ?? []).filter((item) => item.status === "suggested");

	useEffect(() => {
		document.title = t("app.pageTitle", {
			page: t("settings.recurring.title"),
			app: t("app.name"),
		});
	}, [t]);

	const runDetection = () =>
		detect.mutate(undefined, {
			onSuccess: ({ detected }) => toast.success(t("recurring.detected", { count: detected })),
			onError: (error) => showErrorToast(errorCodeOf(error)),
		});

	const runCleanup = () =>
		cleanup.mutate(undefined, {
			onSuccess: ({ inactive }) => toast.success(t("recurring.cleaned", { count: inactive })),
			onError: (error) => showErrorToast(errorCodeOf(error)),
		});

	const toggle = (next: boolean) =>
		save.mutate(next, {
			onSuccess: () => toast.success(t("settings.recurring.saved")),
			onError: (error) => showErrorToast(errorCodeOf(error)),
		});

	return (
		<Page
			centred
			title={t("settings.recurring.title")}
			description={t("settings.recurring.description")}
			actions={
				enabled === true && (
					<>
						<Button variant="outline" disabled={cleanup.isPending} onClick={runCleanup}>
							{t("recurring.cleanup")}
						</Button>
						<Button disabled={detect.isPending} onClick={runDetection}>
							{t("settings.recurring.detect")}
						</Button>
					</>
				)
			}
			className="gap-4"
		>
			<div className="flex items-start justify-between gap-4 rounded-xl border bg-card p-4">
				<div className="flex flex-col gap-0.5">
					<Label htmlFor="recurring-enabled">{t("settings.recurring.enable")}</Label>
					<p id="recurring-enabled-description" className="text-sm text-muted-foreground">
						{t("settings.recurring.enableDescription")}
					</p>
				</div>
				<Switch
					id="recurring-enabled"
					checked={enabled ?? false}
					disabled={!admin || enabled === undefined || save.isPending}
					aria-describedby="recurring-enabled-description"
					className="mt-0.5 shrink-0"
					onCheckedChange={toggle}
				/>
			</div>

			{enabled === true && (
				<>
					<Section title={t("settings.recurring.info.title")}>
						<div className="flex flex-col gap-2 p-4 text-sm">
							<p>{t("settings.recurring.info.manual")}</p>
							<p>{t("settings.recurring.info.cleanup")}</p>
							<p>{t("settings.recurring.info.automatic")}</p>
							<ul className="list-inside list-disc text-muted-foreground">
								{TRIGGERS.map((trigger) => (
									<li key={trigger}>{t(`settings.recurring.info.triggers.${trigger}`)}</li>
								))}
							</ul>
						</div>
					</Section>

					{suggestions.length > 0 && <RecurringSuggestions items={suggestions} admin />}

					<div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-4">
						<div className="flex flex-col gap-0.5">
							<p className="text-sm font-medium">{t("settings.recurring.manage.title")}</p>
							<p className="text-sm text-muted-foreground">
								{t("settings.recurring.manage.description")}
							</p>
						</div>
						<Button variant="outline" asChild>
							<Link to="/bills" search={{ view: "all" }}>
								{t("settings.recurring.manage.action")}
							</Link>
						</Button>
					</div>
				</>
			)}
		</Page>
	);
}
