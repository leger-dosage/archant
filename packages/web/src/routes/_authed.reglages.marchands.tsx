import type { MerchantData } from "@/hooks/useMerchants";

import { createFileRoute } from "@tanstack/react-router";
import { EllipsisIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { MergeMerchantDialog } from "@/components/MergeMerchantDialog";
import { RenameMerchantDialog } from "@/components/RenameMerchantDialog";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useDeleteMerchant, useMerchants } from "@/hooks/useMerchants";
import { errorCodeOf } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";

export const Route = createFileRoute("/_authed/reglages/marchands")({
	component: MerchantsPage,
});

type Action = "rename" | "merge" | "delete";

/**
 * The dialog open, kept while it closes so its content does not vanish
 * mid-animation. An id, not the merchant: the dialog reads it from the
 * current list, so a count or a name that changed since opening is fresh.
 */
type Opened = { action: Action; id: string };

function MerchantRow({
	merchant,
	onAction,
}: {
	merchant: MerchantData;
	onAction: (action: Action) => void;
}) {
	const { t } = useTranslation();

	return (
		<div className="flex min-h-11 items-center gap-3 py-1">
			<span className="min-w-0 flex-1 truncate">{merchant.name}</span>
			<span className="shrink-0 text-sm text-muted-foreground tabular-nums">
				{t("merchants.transactions", { count: merchant.transactionCount })}
			</span>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						aria-label={t("merchants.actions", { name: merchant.name })}
					>
						<EllipsisIcon />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem onSelect={() => onAction("rename")}>
						{t("merchants.rename")}
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={() => onAction("merge")}>
						{t("merchants.merge")}
					</DropdownMenuItem>
					<DropdownMenuItem variant="destructive" onSelect={() => onAction("delete")}>
						{t("merchants.delete")}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

/**
 * Merchants are created from a transaction, by typing a new name in its
 * combobox; this page renames, merges and deletes them.
 */
function MerchantsPage() {
	const { t } = useTranslation();
	const merchants = useMerchants();
	const deleteMerchant = useDeleteMerchant();
	const [opened, setOpened] = useState<Opened | null>(null);
	const [open, setOpen] = useState(false);
	const list = merchants.data ?? [];
	const merchant =
		opened === null ? undefined : list.find((candidate) => candidate.id === opened.id);
	// Deleted or merged elsewhere since it opened: nothing left to act on.
	const gone = opened !== null && merchant === undefined;

	useEffect(() => {
		if (gone) {
			setOpen(false);
			setOpened(null);
		}
	}, [gone]);

	useEffect(() => {
		document.title = t("app.pageTitle", { page: t("merchants.title"), app: t("app.name") });
	}, [t]);

	const remove = (target: MerchantData) =>
		deleteMerchant.mutate(target.id, {
			onSuccess: () => {
				toast.success(t("merchants.deleteDialog.deleted", { name: target.name }));
				setOpen(false);
			},
			onError: (error) => showErrorToast(errorCodeOf(error)),
		});

	return (
		<div className="flex max-w-2xl flex-col gap-6">
			<div className="flex flex-col gap-1">
				<h2 className="text-lg font-semibold">{t("merchants.title")}</h2>
				<p className="text-sm text-muted-foreground">{t("merchants.description")}</p>
			</div>

			{merchants.isPending && (
				<div className="flex flex-col gap-2">
					<Skeleton className="h-11 w-full" />
					<Skeleton className="h-11 w-full" />
				</div>
			)}

			{merchants.isError && (
				<div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-8">
					<p className="text-muted-foreground">{t(`errors.${errorCodeOf(merchants.error)}`)}</p>
					<Button variant="outline" onClick={() => void merchants.refetch()}>
						{t("common.retry")}
					</Button>
				</div>
			)}

			{merchants.data !== undefined &&
				(list.length === 0 ? (
					<p className="text-sm text-muted-foreground">{t("merchants.empty")}</p>
				) : (
					<ul aria-label={t("merchants.title")} className="divide-y">
						{list.map((item) => (
							<li key={item.id}>
								<MerchantRow
									merchant={item}
									onAction={(action) => {
										setOpened({ action, id: item.id });
										setOpen(true);
									}}
								/>
							</li>
						))}
					</ul>
				))}

			{opened?.action === "rename" && merchant !== undefined && (
				<RenameMerchantDialog open={open} onOpenChange={setOpen} merchant={merchant} />
			)}
			{opened?.action === "merge" && merchant !== undefined && (
				<MergeMerchantDialog
					open={open}
					onOpenChange={setOpen}
					merchant={merchant}
					merchants={list}
				/>
			)}
			{opened?.action === "delete" && merchant !== undefined && (
				<ConfirmDialog
					open={open}
					onOpenChange={setOpen}
					title={t("merchants.deleteDialog.title", { name: merchant.name })}
					description={
						merchant.transactionCount === 0
							? t("merchants.deleteDialog.none")
							: t("merchants.deleteDialog.count", { count: merchant.transactionCount })
					}
					confirmLabel={t("merchants.deleteDialog.action")}
					destructive
					pending={deleteMerchant.isPending}
					onConfirm={() => remove(merchant)}
				/>
			)}
		</div>
	);
}
