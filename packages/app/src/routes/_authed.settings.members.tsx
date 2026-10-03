import type { InvitationData } from "@/hooks/useInvitations";

import { createFileRoute } from "@tanstack/react-router";
import { UsersIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { InsetGroup } from "@/components/InsetGroup";
import { InviteDialog } from "@/components/InviteDialog";
import { ListCard } from "@/components/ListCard";
import { Page } from "@/components/Page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useInvitations, useRevokeInvitation } from "@/hooks/useInvitations";
import { errorCodeOf } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";

export const Route = createFileRoute("/_authed/settings/members")({
	component: MembersPage,
});

// Day and time: a link made this morning expires three days later at that hour.
const moment = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" });

function InvitationRow({
	invitation,
	onRevoke,
}: {
	invitation: InvitationData;
	onRevoke: () => void;
}) {
	const { t } = useTranslation();

	return (
		<div className="flex min-h-14 flex-wrap items-center gap-3 px-4 py-2 hover:bg-hover">
			<div className="flex min-w-0 flex-1 flex-col">
				<span className="truncate font-medium">{invitation.email}</span>
				<span className="text-sm text-muted-foreground">
					{t(`members.roles.${invitation.role}`)} ·{" "}
					{t("members.expires", { date: moment.format(invitation.expiresAt) })}
				</span>
			</div>
			<Button
				variant="outline"
				aria-label={t("members.revokeNamed", { email: invitation.email })}
				onClick={onRevoke}
			>
				{t("members.revoke")}
			</Button>
		</div>
	);
}

/**
 * « Réglages › Membres »: the invitations still pending, each revoked at
 * once, and « Inviter ». The members themselves join this page with Story
 * 20.3.
 */
function MembersPage() {
	const { t } = useTranslation();
	const invitations = useInvitations();
	const revoke = useRevokeInvitation();
	const [inviting, setInviting] = useState(false);
	const [target, setTarget] = useState<InvitationData | null>(null);
	const [open, setOpen] = useState(false);

	useEffect(() => {
		document.title = t("app.pageTitle", { page: t("members.title"), app: t("app.name") });
	}, [t]);

	const confirm = (invitation: InvitationData) =>
		revoke.mutate(invitation.id, {
			onSuccess: () => {
				toast.success(t("members.revoked", { email: invitation.email }));
				setOpen(false);
			},
			onError: (error) => {
				const code = errorCodeOf(error);
				showErrorToast(code);

				// Accepted, expired or revoked since: nothing left to confirm.
				if (code === "NOT_FOUND") {
					setOpen(false);
				}
			},
		});

	const list = invitations.data;
	const invite = <Button onClick={() => setInviting(true)}>{t("members.invite")}</Button>;

	return (
		<Page
			centred
			title={t("members.title")}
			description={t("members.description")}
			// An empty list offers its own, the one way forward.
			actions={list !== undefined && list.length === 0 ? undefined : invite}
			className="gap-4"
		>
			{invitations.isPending && (
				<div className="flex flex-col gap-2">
					<Skeleton className="h-14 w-full" />
					<Skeleton className="h-14 w-full" />
				</div>
			)}

			{invitations.isError && (
				<div role="alert" className="flex flex-col items-start gap-3 rounded-xl border bg-card p-4">
					<p className="text-muted-foreground">{t(`errors.${errorCodeOf(invitations.error)}`)}</p>
					<Button variant="outline" onClick={() => void invitations.refetch()}>
						{t("common.retry")}
					</Button>
				</div>
			)}

			{list !== undefined &&
				(list.length === 0 ? (
					<EmptyState
						level={2}
						icon={{ kind: "transfer", icon: UsersIcon }}
						title={t("members.empty.title")}
						description={t("members.empty.description")}
						action={invite}
					/>
				) : (
					<ListCard>
						<InsetGroup level={2} title={t("members.pending")} count={list.length}>
							<ul aria-label={t("members.pending")} className="divide-y divide-line">
								{list.map((invitation) => (
									<li key={invitation.id}>
										<InvitationRow
											invitation={invitation}
											onRevoke={() => {
												setTarget(invitation);
												setOpen(true);
											}}
										/>
									</li>
								))}
							</ul>
						</InsetGroup>
					</ListCard>
				))}

			<InviteDialog open={inviting} onOpenChange={setInviting} />

			{target !== null && (
				<ConfirmDialog
					open={open}
					onOpenChange={setOpen}
					title={t("members.revokeDialog.title", { email: target.email })}
					description={t("members.revokeDialog.description")}
					confirmLabel={t("members.revoke")}
					destructive
					pending={revoke.isPending}
					onConfirm={() => confirm(target)}
				/>
			)}
		</Page>
	);
}
