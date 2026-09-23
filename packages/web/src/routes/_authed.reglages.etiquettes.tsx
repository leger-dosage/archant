import type { TagData } from "@/hooks/useTags";

import { createFileRoute } from "@tanstack/react-router";
import { EllipsisIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { RenameTagDialog } from "@/components/RenameTagDialog";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useDeleteTag, useTags } from "@/hooks/useTags";
import { errorCodeOf } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";

export const Route = createFileRoute("/_authed/reglages/etiquettes")({
	component: TagsPage,
});

type Action = "rename" | "delete";

/**
 * The dialog open, kept while it closes so its content does not vanish
 * mid-animation. An id, not the tag: the dialog reads it from the current
 * list, so a count or a name that changed since opening is fresh.
 */
type Opened = { action: Action; id: string };

function TagRow({ tag, onAction }: { tag: TagData; onAction: (action: Action) => void }) {
	const { t } = useTranslation();

	return (
		<div className="flex min-h-11 items-center gap-3 py-1">
			<span className="min-w-0 flex-1 truncate">{tag.name}</span>
			<span className="shrink-0 text-sm text-muted-foreground tabular-nums">
				{t("tags.transactions", { count: tag.transactionCount })}
			</span>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="ghost" size="icon" aria-label={t("tags.actions", { name: tag.name })}>
						<EllipsisIcon />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem onSelect={() => onAction("rename")}>
						{t("tags.rename")}
					</DropdownMenuItem>
					<DropdownMenuItem variant="destructive" onSelect={() => onAction("delete")}>
						{t("tags.delete")}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

/**
 * Tags are created from a transaction, by typing a new name in its combobox;
 * this page renames and deletes them.
 */
function TagsPage() {
	const { t } = useTranslation();
	const tags = useTags();
	const deleteTag = useDeleteTag();
	const [opened, setOpened] = useState<Opened | null>(null);
	const [open, setOpen] = useState(false);
	const list = tags.data ?? [];
	const tag = opened === null ? undefined : list.find((candidate) => candidate.id === opened.id);
	// Deleted elsewhere since it opened: nothing left to act on.
	const gone = opened !== null && tag === undefined;

	useEffect(() => {
		if (gone) {
			setOpen(false);
			setOpened(null);
		}
	}, [gone]);

	useEffect(() => {
		document.title = t("app.pageTitle", { page: t("tags.title"), app: t("app.name") });
	}, [t]);

	const remove = (target: TagData) =>
		deleteTag.mutate(target.id, {
			onSuccess: () => {
				toast.success(t("tags.deleteDialog.deleted", { name: target.name }));
				setOpen(false);
			},
			onError: (error) => showErrorToast(errorCodeOf(error)),
		});

	return (
		<div className="flex max-w-2xl flex-col gap-6">
			<div className="flex flex-col gap-1">
				<h2 className="text-lg font-semibold">{t("tags.title")}</h2>
				<p className="text-sm text-muted-foreground">{t("tags.description")}</p>
			</div>

			{tags.isPending && (
				<div className="flex flex-col gap-2">
					<Skeleton className="h-11 w-full" />
					<Skeleton className="h-11 w-full" />
				</div>
			)}

			{tags.isError && (
				<div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-8">
					<p className="text-muted-foreground">{t(`errors.${errorCodeOf(tags.error)}`)}</p>
					<Button variant="outline" onClick={() => void tags.refetch()}>
						{t("common.retry")}
					</Button>
				</div>
			)}

			{tags.data !== undefined &&
				(list.length === 0 ? (
					<p className="text-sm text-muted-foreground">{t("tags.empty")}</p>
				) : (
					<ul aria-label={t("tags.title")} className="divide-y">
						{list.map((item) => (
							<li key={item.id}>
								<TagRow
									tag={item}
									onAction={(action) => {
										setOpened({ action, id: item.id });
										setOpen(true);
									}}
								/>
							</li>
						))}
					</ul>
				))}

			{opened?.action === "rename" && tag !== undefined && (
				<RenameTagDialog open={open} onOpenChange={setOpen} tag={tag} />
			)}
			{opened?.action === "delete" && tag !== undefined && (
				<ConfirmDialog
					open={open}
					onOpenChange={setOpen}
					title={t("tags.deleteDialog.title", { name: tag.name })}
					description={
						tag.transactionCount === 0
							? t("tags.deleteDialog.none")
							: t("tags.deleteDialog.count", { count: tag.transactionCount })
					}
					confirmLabel={t("tags.deleteDialog.action")}
					destructive
					pending={deleteTag.isPending}
					onConfirm={() => remove(tag)}
				/>
			)}
		</div>
	);
}
