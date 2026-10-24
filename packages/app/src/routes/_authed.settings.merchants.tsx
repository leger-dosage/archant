import type { MerchantData } from "@/hooks/useMerchants";

import { createFileRoute } from "@tanstack/react-router";
import { CombineIcon, EllipsisIcon, StoreIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { InsetGroup } from "@/components/InsetGroup";
import { ListCard } from "@/components/ListCard";
import { MerchantDialog } from "@/components/MerchantDialog";
import { MergeMerchantDialog } from "@/components/MergeMerchantDialog";
import { Page } from "@/components/Page";
import { TintedIcon } from "@/components/TintedIcon";
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

export const Route = createFileRoute("/_authed/settings/merchants")({
	component: MerchantsPage,
});

type Action = "edit" | "delete";

/**
 * The dialog open, kept while it closes so its content does not vanish
 * mid-animation. An id, not the merchant: the dialog reads it from the
 * current list, so a count or a name that changed since opening is fresh.
 */
type Opened = { action: "create" | "merge" } | { action: Action; id: string };

function MerchantRow({
	merchant,
	onAction,
}: {
	merchant: MerchantData;
	onAction: (action: Action) => void;
}) {
	const { t } = useTranslation();

	return (
		<div className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-hover">
			<TintedIcon subject={{ kind: "merchant", name: merchant.name, color: merchant.color }} />
			<span className="min-w-0 flex-1 truncate font-medium">{merchant.name}</span>
			<span className="shrink-0 text-muted-foreground tabular-nums">
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
					<DropdownMenuItem onSelect={() => onAction("edit")}>
						{t("merchants.edit")}
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
 * Creates, edits, merges and deletes merchants, as Sure's
 * `family_merchants/index.html.erb`: merging several at once from the page
 * menu. A transaction's or a rule's
 * combobox creates one too, by typing a new name.
 */
function MerchantsPage() {
	const { t } = useTranslation();
	const merchants = useMerchants();
	const deleteMerchant = useDeleteMerchant();
	const [opened, setOpened] = useState<Opened | null>(null);
	const [open, setOpen] = useState(false);
	const list = merchants.data ?? [];
	const merchant =
		opened === null || !("id" in opened)
			? undefined
			: list.find((candidate) => candidate.id === opened.id);
	// Deleted or merged elsewhere since it opened: nothing left to act on.
	const gone = opened !== null && "id" in opened && merchant === undefined;

	useEffect(() => {
		if (gone) {
			setOpen(false);
			setOpened(null);
		}
	}, [gone]);

	const show = (next: Opened) => {
		setOpened(next);
		setOpen(true);
	};

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
		<Page
			centred
			title={t("merchants.title")}
			description={t("merchants.description")}
			actions={
				// An empty list offers its own, the one way forward.
				merchants.data !== undefined && list.length === 0 ? undefined : (
					<div className="flex items-center gap-2">
						{/* Sure's page menu: merge several. */}
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="outline" size="icon" aria-label={t("merchants.menu")}>
									<EllipsisIcon />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuItem
									disabled={list.length < 2}
									onSelect={() => show({ action: "merge" })}
								>
									<CombineIcon />
									{t("merchants.mergeAll")}
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
						<Button onClick={() => show({ action: "create" })}>{t("merchants.add")}</Button>
					</div>
				)
			}
			className="gap-4"
		>
			{merchants.isPending && (
				<div className="flex flex-col gap-2">
					<Skeleton className="h-14 w-full" />
					<Skeleton className="h-14 w-full" />
				</div>
			)}

			{merchants.isError && (
				<div role="alert" className="flex flex-col items-start gap-3 rounded-xl border bg-card p-4">
					<p className="text-muted-foreground">{t(`errors.${errorCodeOf(merchants.error)}`)}</p>
					<Button variant="outline" onClick={() => void merchants.refetch()}>
						{t("common.retry")}
					</Button>
				</div>
			)}

			{merchants.data !== undefined &&
				(list.length === 0 ? (
					<EmptyState
						level={2}
						icon={{ kind: "transfer", icon: StoreIcon }}
						title={t("merchants.empty.title")}
						description={t("merchants.empty.description")}
						action={
							<Button onClick={() => show({ action: "create" })}>{t("merchants.add")}</Button>
						}
					/>
				) : (
					<ListCard>
						<InsetGroup level={2} title={t("merchants.list")} count={list.length}>
							<ul aria-label={t("merchants.title")} className="divide-y divide-line">
								{list.map((item) => (
									<li key={item.id}>
										<MerchantRow
											merchant={item}
											onAction={(action) => show({ action, id: item.id })}
										/>
									</li>
								))}
							</ul>
						</InsetGroup>
					</ListCard>
				))}

			{(opened?.action === "create" || (opened?.action === "edit" && merchant !== undefined)) && (
				<MerchantDialog open={open} onOpenChange={setOpen} merchant={merchant} />
			)}
			{opened?.action === "merge" && (
				<MergeMerchantDialog open={open} onOpenChange={setOpen} merchants={list} />
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
		</Page>
	);
}
