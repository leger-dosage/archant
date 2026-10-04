import type { InvitationData } from "@/hooks/useInvitations";
import type { MemberData } from "@/hooks/useMembers";

import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { EllipsisIcon, MailIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { InsetGroup } from "@/components/InsetGroup";
import { InviteDialog } from "@/components/InviteDialog";
import { ListCard } from "@/components/ListCard";
import { Page } from "@/components/Page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useInvitations, useRevokeInvitation } from "@/hooks/useInvitations";
import { useMembers, useRemoveMember, useSetMemberRole } from "@/hooks/useMembers";
import { errorCodeOf } from "@/lib/api";
import { sessionQuery } from "@/lib/auth-client";
import { showErrorToast } from "@/lib/error-toast";

export const Route = createFileRoute("/_authed/settings/members")({
	component: MembersPage,
});

// Day and time: a link made this morning expires three days later at that hour.
const moment = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" });

/** A member by first name, else by email: Better Auth stores a blank name as `""`. */
const nameOf = (member: MemberData) => (member.name.trim() === "" ? member.email : member.name);

/** What the confirmation is for: another member's promotion, demotion or removal. */
type Change = { member: MemberData; action: "promote" | "demote" | "remove" };

function MemberRow({
	member,
	self,
	onChange,
}: {
	member: MemberData;
	self: boolean;
	onChange: (action: Change["action"]) => void;
}) {
	const { t } = useTranslation();
	const name = nameOf(member);

	return (
		<div className="flex min-h-14 flex-wrap items-center gap-3 px-4 py-2 hover:bg-hover">
			<div className="flex min-w-0 flex-1 flex-col">
				<span className="truncate font-medium">{name}</span>
				<span className="truncate text-sm text-muted-foreground">
					{name === member.email
						? t(`members.roles.${member.role}`)
						: `${member.email} · ${t(`members.roles.${member.role}`)}`}
				</span>
			</div>
			{/* Nobody changes their own role or removes themselves: another administrator does. */}
			{self ? (
				<Badge variant="outline">{t("members.you")}</Badge>
			) : (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="ghost" size="icon" aria-label={t("members.actions", { name })}>
							<EllipsisIcon />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						{member.role === "admin" ? (
							<DropdownMenuItem onSelect={() => onChange("demote")}>
								{t("members.demote")}
							</DropdownMenuItem>
						) : (
							<DropdownMenuItem onSelect={() => onChange("promote")}>
								{t("members.promote")}
							</DropdownMenuItem>
						)}
						<DropdownMenuItem variant="destructive" onSelect={() => onChange("remove")}>
							{t("members.remove")}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			)}
		</div>
	);
}

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

function ListSkeleton() {
	return (
		<div className="flex flex-col gap-2 p-4">
			<Skeleton className="h-10 w-full" />
			<Skeleton className="h-10 w-full" />
		</div>
	);
}

function ListError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
	const { t } = useTranslation();

	return (
		<div role="alert" className="flex flex-col items-start gap-3 p-4">
			<p className="text-muted-foreground">{t(`errors.${errorCodeOf(error)}`)}</p>
			<Button variant="outline" onClick={onRetry}>
				{t("common.retry")}
			</Button>
		</div>
	);
}

/** The confirmation of a change to another member, saying what it takes away. */
function ChangeDialog({
	change,
	open,
	onOpenChange,
}: {
	change: Change;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const { t } = useTranslation();
	const setRole = useSetMemberRole();
	const remove = useRemoveMember();
	const name = nameOf(change.member);
	const failed = (error: unknown) => {
		const code = errorCodeOf(error);
		showErrorToast(code);

		// Gone, or the last administrator since: nothing left to confirm.
		if (code === "NOT_FOUND" || code === "LAST_ADMIN") {
			onOpenChange(false);
		}
	};
	const done = (message: string) => {
		toast.success(message);
		onOpenChange(false);
	};

	const confirm = () => {
		if (change.action === "remove") {
			remove.mutate(change.member.id, {
				onSuccess: () => done(t("members.removed", { name })),
				onError: failed,
			});
			return;
		}

		const role = change.action === "promote" ? "admin" : "viewer";
		setRole.mutate(
			{ id: change.member.id, role },
			{
				onSuccess: () =>
					done(t(change.action === "promote" ? "members.promoted" : "members.demoted", { name })),
				onError: failed,
			},
		);
	};

	return (
		<ConfirmDialog
			open={open}
			onOpenChange={onOpenChange}
			title={t(`members.${change.action}Dialog.title`, { name })}
			description={t(`members.${change.action}Dialog.description`, { name })}
			confirmLabel={t(`members.${change.action}`)}
			destructive={change.action !== "promote"}
			pending={setRole.isPending || remove.isPending}
			onConfirm={confirm}
		/>
	);
}

/**
 * « Réglages › Membres »: who has access, each other member's role changed
 * or the member removed after a confirmation, then the invitations still
 * pending, each revoked at once, and « Inviter ». An administrator's page:
 * the settings route sends a viewer to « Sécurité ».
 */
function MembersPage() {
	const { t } = useTranslation();
	const session = useQuery(sessionQuery);
	const members = useMembers();
	const invitations = useInvitations();
	const revoke = useRevokeInvitation();
	const [inviting, setInviting] = useState(false);
	// Kept while a dialog closes, so its text does not vanish mid-animation.
	const [revoking, setRevoking] = useState<InvitationData | null>(null);
	const [revokeOpen, setRevokeOpen] = useState(false);
	const [change, setChange] = useState<Change | null>(null);
	const [changeOpen, setChangeOpen] = useState(false);
	const selfId = session.data?.user.id;

	useEffect(() => {
		document.title = t("app.pageTitle", { page: t("members.title"), app: t("app.name") });
	}, [t]);

	const confirmRevoke = (invitation: InvitationData) =>
		revoke.mutate(invitation.id, {
			onSuccess: () => {
				toast.success(t("members.revoked", { email: invitation.email }));
				setRevokeOpen(false);
			},
			onError: (error) => {
				const code = errorCodeOf(error);
				showErrorToast(code);

				// Accepted, expired or revoked since: nothing left to confirm.
				if (code === "NOT_FOUND") {
					setRevokeOpen(false);
				}
			},
		});

	const pending = invitations.data;

	return (
		<Page
			centred
			title={t("members.title")}
			description={t("members.description")}
			actions={<Button onClick={() => setInviting(true)}>{t("members.invite")}</Button>}
			className="gap-4"
		>
			{/* Each list on its own: one failing leaves the other readable. */}
			<ListCard>
				<InsetGroup
					level={2}
					title={t("members.list")}
					{...(members.data === undefined ? {} : { count: members.data.length })}
				>
					{members.isPending && <ListSkeleton />}
					{members.isError && (
						<ListError error={members.error} onRetry={() => void members.refetch()} />
					)}
					{members.data !== undefined && (
						<ul aria-label={t("members.list")} className="divide-y divide-line">
							{members.data.map((member) => (
								<li key={member.id}>
									<MemberRow
										member={member}
										self={member.id === selfId}
										onChange={(action) => {
											setChange({ member, action });
											setChangeOpen(true);
										}}
									/>
								</li>
							))}
						</ul>
					)}
				</InsetGroup>
				<InsetGroup
					level={2}
					title={t("members.pending")}
					{...(pending === undefined ? {} : { count: pending.length })}
				>
					{invitations.isPending && <ListSkeleton />}
					{invitations.isError && (
						<ListError error={invitations.error} onRetry={() => void invitations.refetch()} />
					)}
					{pending !== undefined &&
						(pending.length === 0 ? (
							// « Inviter » is in the page's actions already.
							<EmptyState
								flush
								icon={{ kind: "transfer", icon: MailIcon }}
								title={t("members.empty.title")}
								description={t("members.empty.description")}
								action={null}
							/>
						) : (
							<ul aria-label={t("members.pending")} className="divide-y divide-line">
								{pending.map((invitation) => (
									<li key={invitation.id}>
										<InvitationRow
											invitation={invitation}
											onRevoke={() => {
												setRevoking(invitation);
												setRevokeOpen(true);
											}}
										/>
									</li>
								))}
							</ul>
						))}
				</InsetGroup>
			</ListCard>

			<InviteDialog open={inviting} onOpenChange={setInviting} />

			{revoking !== null && (
				<ConfirmDialog
					open={revokeOpen}
					onOpenChange={setRevokeOpen}
					title={t("members.revokeDialog.title", { email: revoking.email })}
					description={t("members.revokeDialog.description")}
					confirmLabel={t("members.revoke")}
					destructive
					pending={revoke.isPending}
					onConfirm={() => confirmRevoke(revoking)}
				/>
			)}

			{change !== null && (
				<ChangeDialog change={change} open={changeOpen} onOpenChange={setChangeOpen} />
			)}
		</Page>
	);
}
