import type { AssistantData } from "@/hooks/useAssistants";

import { createFileRoute } from "@tanstack/react-router";
import { BotIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CopyableAddress } from "@/components/CopyableAddress";
import { EmptyState } from "@/components/EmptyState";
import { InsetGroup } from "@/components/InsetGroup";
import { ListCard } from "@/components/ListCard";
import { Page } from "@/components/Page";
import { Section } from "@/components/Section";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAssistants, useDisconnectAssistant } from "@/hooks/useAssistants";
import { errorCodeOf } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";

const ASSISTANT_GUIDE =
	"https://github.com/leger-dosage/archant/blob/main/docs/deployment.md#connecting-an-assistant";

export const Route = createFileRoute("/_authed/settings/assistants")({
	component: AssistantsPage,
});

// Day and time: a last call minutes ago and one last month read differently.
const moment = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" });

function GuideLink() {
	const { t } = useTranslation();

	return (
		<a
			href={ASSISTANT_GUIDE}
			target="_blank"
			rel="noreferrer"
			className="text-sm font-medium underline underline-offset-4"
		>
			{t("assistants.guide")}
		</a>
	);
}

function AssistantRow({
	assistant,
	onDisconnect,
}: {
	assistant: AssistantData;
	onDisconnect: () => void;
}) {
	const { t } = useTranslation();
	const name = assistant.name ?? t("assistants.unnamed");
	const access = assistant.scopes.includes("archant:write")
		? t("assistants.readWrite")
		: t("assistants.readOnly");

	return (
		<div className="flex min-h-14 flex-wrap items-center gap-3 px-4 py-2 hover:bg-hover">
			<div className="flex min-w-0 flex-1 flex-col">
				<span className="truncate font-medium">{name}</span>
				<span className="text-sm text-muted-foreground">
					{access} · {t("assistants.connectedAt", { date: moment.format(assistant.connectedAt) })} ·{" "}
					{assistant.lastCallAt === null
						? t("assistants.noCall")
						: t("assistants.lastCallAt", { date: moment.format(assistant.lastCallAt) })}
				</span>
			</div>
			<Button
				variant="outline"
				aria-label={t("assistants.disconnectNamed", { name })}
				onClick={onDisconnect}
			>
				{t("assistants.disconnect")}
			</Button>
		</div>
	);
}

/**
 * « Réglages › Assistants IA »: the address to give Claude Code, VS Code or
 * Cursor, and every assistant the owner allowed, each disconnected at once.
 * Without HTTPS the server loads no assistant support, and the page says why.
 */
function AssistantsPage() {
	const { t } = useTranslation();
	const assistants = useAssistants();
	const disconnect = useDisconnectAssistant();
	const [target, setTarget] = useState<AssistantData | null>(null);
	const [open, setOpen] = useState(false);

	useEffect(() => {
		document.title = t("app.pageTitle", { page: t("assistants.title"), app: t("app.name") });
	}, [t]);

	const confirm = (assistant: AssistantData) =>
		disconnect.mutate(assistant.clientId, {
			onSuccess: () => {
				toast.success(
					t("assistants.disconnected", { name: assistant.name ?? t("assistants.unnamed") }),
				);
				setOpen(false);
			},
			onError: (error) => {
				const code = errorCodeOf(error);
				showErrorToast(code);

				// Already gone: the dialog has nothing left to confirm.
				if (code === "ASSISTANT_NOT_FOUND") {
					setOpen(false);
				}
			},
		});

	const data = assistants.data;

	return (
		<Page
			centred
			title={t("assistants.title")}
			description={t("assistants.description")}
			className="gap-4"
		>
			{assistants.isPending && (
				<div className="flex flex-col gap-2">
					<Skeleton className="h-24 w-full" />
					<Skeleton className="h-14 w-full" />
				</div>
			)}

			{assistants.isError && (
				<div role="alert" className="flex flex-col items-start gap-3 rounded-xl border bg-card p-4">
					<p className="text-muted-foreground">{t(`errors.${errorCodeOf(assistants.error)}`)}</p>
					<Button variant="outline" onClick={() => void assistants.refetch()}>
						{t("common.retry")}
					</Button>
				</div>
			)}

			{data !== undefined && !data.available && (
				<div role="alert" className="flex flex-col items-start gap-3 rounded-xl border bg-card p-4">
					<p className="font-medium">{t("assistants.unavailable.title")}</p>
					<p className="text-sm text-muted-foreground">{t("assistants.unavailable.description")}</p>
					<GuideLink />
				</div>
			)}

			{data?.available === true && (
				<>
					<Section title={t("assistants.address")}>
						<div className="flex flex-col gap-3 p-4">
							<p className="text-sm text-muted-foreground">{t("assistants.addressHelp")}</p>
							<CopyableAddress value={data.address} copyLabel={t("assistants.copy")} />
							<GuideLink />
						</div>
					</Section>

					{data.assistants.length === 0 ? (
						<EmptyState
							level={2}
							icon={{ kind: "transfer", icon: BotIcon }}
							title={t("assistants.empty.title")}
							description={t("assistants.empty.description")}
							action={null}
						/>
					) : (
						<ListCard>
							<InsetGroup level={2} title={t("assistants.list")} count={data.assistants.length}>
								<ul aria-label={t("assistants.list")} className="divide-y divide-line">
									{data.assistants.map((assistant) => (
										<li key={assistant.clientId}>
											<AssistantRow
												assistant={assistant}
												onDisconnect={() => {
													setTarget(assistant);
													setOpen(true);
												}}
											/>
										</li>
									))}
								</ul>
							</InsetGroup>
						</ListCard>
					)}
				</>
			)}

			{target !== null && (
				<ConfirmDialog
					open={open}
					onOpenChange={setOpen}
					title={t("assistants.disconnectDialog.title", {
						name: target.name ?? t("assistants.unnamed"),
					})}
					description={t("assistants.disconnectDialog.description")}
					confirmLabel={t("assistants.disconnect")}
					destructive
					pending={disconnect.isPending}
					onConfirm={() => confirm(target)}
				/>
			)}
		</Page>
	);
}
