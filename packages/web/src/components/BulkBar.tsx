import type { Selection, SelectionTarget } from "@/hooks/useSelection";
import type { BulkPatch } from "@/hooks/useTransactions";
import type { ShortcutId } from "@/lib/shortcuts";
import type { TransactionFilters } from "@/lib/transaction-filters";
import type { ReactNode } from "react";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { CategoryCombobox } from "@/components/CategoryCombobox";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { MerchantCombobox } from "@/components/MerchantCombobox";
import { ShortcutHint } from "@/components/ShortcutHint";
import { TagCombobox } from "@/components/TagCombobox";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCategories } from "@/hooks/useCategories";
import { useMerchants } from "@/hooks/useMerchants";
import { useTags } from "@/hooks/useTags";
import { useBulkDeleteTransactions, useBulkUpdateTransactions } from "@/hooks/useTransactions";

/** The bar's comboboxes, which `c`, `m` and `t` open while rows are ticked. */
export type BulkPicker = "category" | "merchant" | "tags";

// On the bar's dark background, as in the mockup.
const barButton = "text-background hover:bg-background/15 hover:text-background";

type BulkBarProps = {
	selection: Selection;
	target: SelectionTarget;
	/** How many rows the current filters match, on every page. */
	total: number;
	filters: TransactionFilters;
	picker: BulkPicker | null;
	onPickerChange: (picker: BulkPicker | null) => void;
};

/** What the API receives: the ticked ids, or the filters for « every result ». */
function selectionBody(target: SelectionTarget, filters: TransactionFilters) {
	return target.kind === "all" ? { filter: filters } : { ids: [...target.ids] };
}

function PickerButton({
	label,
	shortcut,
	open,
	onOpenChange,
	disabled,
	children,
}: {
	label: string;
	disabled: boolean;
	shortcut: ShortcutId;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	children: ReactNode;
}) {
	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<Tooltip>
				<TooltipTrigger asChild>
					<PopoverTrigger asChild>
						<Button variant="ghost" size="sm" className={barButton} disabled={disabled}>
							{label}
						</Button>
					</PopoverTrigger>
				</TooltipTrigger>
				<TooltipContent side="top">
					<ShortcutHint id={shortcut} label={label} />
				</TooltipContent>
			</Tooltip>
			<PopoverContent align="start" side="top" className="w-72 p-0">
				{children}
			</PopoverContent>
		</Popover>
	);
}

/**
 * The actions on the ticked rows, shown at the bottom of `/operations` while
 * one is ticked: the count, « Tout sélectionner », then the category, the
 * merchant, tags to add, the exclusion and the delete. A success unticks
 * every row and states the count; a failure keeps them, with a destructive
 * toast. No « Annuler », as in Sure: a wrong bulk edit is fixed by another.
 */
export function BulkBar({
	selection,
	target,
	total,
	filters,
	picker,
	onPickerChange,
}: BulkBarProps) {
	const { t } = useTranslation();
	const categories = useCategories();
	const merchants = useMerchants();
	const tags = useTags();
	const update = useBulkUpdateTransactions();
	const remove = useBulkDeleteTransactions();
	// The tags picked so far, added once when the combobox closes.
	const [tagDraft, setTagDraft] = useState<string[]>([]);
	const [confirming, setConfirming] = useState(false);
	const count = target.kind === "all" ? total : target.ids.length;
	const body = selectionBody(target, filters);
	// A second pick while one runs would send a second request on the same rows.
	const busy = update.isPending || remove.isPending;

	// `mutateAsync` rather than `mutate`'s callbacks: the refetch after a
	// success can drop the ticked rows and unmount this bar, which would
	// silently skip them. The hook shows the failure toast.
	const apply = async (patch: BulkPatch, message: (updated: number) => string) => {
		try {
			const { updated } = await update.mutateAsync({ ...body, patch });
			selection.clear();
			toast.success(message(updated));
		} catch {
			// Shown by the hook; the selection stays for another try.
		}
	};

	const openChange = (kind: BulkPicker) => (open: boolean) => {
		if (open) {
			onPickerChange(kind);

			return;
		}

		if (kind === "tags" && tagDraft.length > 0) {
			void apply({ addTagIds: tagDraft }, (updated) =>
				t("operations.bulk.tagsAdded", { count: updated }),
			);
		}
		setTagDraft([]);
		onPickerChange(null);
	};

	const deleteAll = async () => {
		try {
			const { deleted } = await remove.mutateAsync(body);
			selection.clear();
			toast.success(t("operations.bulk.deleted", { count: deleted }));
		} catch {
			// Shown by the hook; the selection stays for another try.
		}
		setConfirming(false);
	};

	return (
		<div
			role="toolbar"
			aria-label={t("operations.bulk.toolbar")}
			className="sticky bottom-4 z-10 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-foreground px-4 py-2 text-background shadow-lg"
		>
			<p aria-live="polite" className="text-sm font-semibold whitespace-nowrap">
				{t("operations.bulk.selected", { count })}
			</p>
			{target.kind !== "all" && count < total && (
				<Button
					variant="link"
					size="sm"
					className="h-auto px-0 text-xs text-background/70 hover:text-background"
					onClick={selection.selectAll}
				>
					{t("operations.bulk.selectAll", { count: total })}
				</Button>
			)}
			<div className="flex flex-1 flex-wrap items-center justify-end gap-1">
				<PickerButton
					label={t("operations.bulk.category")}
					shortcut="categoriseRow"
					open={picker === "category"}
					onOpenChange={openChange("category")}
					disabled={busy}
				>
					<CategoryCombobox
						categories={categories.data ?? []}
						value={undefined}
						onSelect={(categoryId) => {
							onPickerChange(null);
							void apply({ categoryId }, (updated) =>
								t("operations.bulk.categoryChanged", { count: updated }),
							);
						}}
					/>
				</PickerButton>
				<PickerButton
					label={t("operations.bulk.merchant")}
					shortcut="setMerchantRow"
					open={picker === "merchant"}
					onOpenChange={openChange("merchant")}
					disabled={busy}
				>
					<MerchantCombobox
						merchants={merchants.data ?? []}
						value={undefined}
						onSelect={(merchantId) => {
							onPickerChange(null);
							void apply({ merchantId }, (updated) =>
								t("operations.bulk.merchantChanged", { count: updated }),
							);
						}}
					/>
				</PickerButton>
				<PickerButton
					label={t("operations.bulk.tags")}
					shortcut="setTagsRow"
					open={picker === "tags"}
					onOpenChange={openChange("tags")}
					disabled={busy}
				>
					<TagCombobox
						tags={tags.data ?? []}
						value={tagDraft}
						onToggle={(tagId) =>
							setTagDraft((draft) =>
								draft.includes(tagId) ? draft.filter((id) => id !== tagId) : [...draft, tagId],
							)
						}
					/>
				</PickerButton>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="ghost" size="sm" className={barButton} disabled={busy}>
							{t("operations.bulk.exclude")}
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent side="top" align="end" className="w-auto">
						<DropdownMenuItem
							onSelect={() =>
								void apply({ excluded: true }, (updated) =>
									t("operations.bulk.excluded", { count: updated }),
								)
							}
						>
							{t("operations.bulk.excludeAction")}
						</DropdownMenuItem>
						<DropdownMenuItem
							onSelect={() =>
								void apply({ excluded: false }, (updated) =>
									t("operations.bulk.included", { count: updated }),
								)
							}
						>
							{t("operations.bulk.includeAction")}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
				<Button
					variant="ghost"
					size="sm"
					// The bar inverts the theme, so the red darkens where the bar turns light.
					className="text-red-400 hover:bg-background/15 hover:text-red-300 dark:text-red-600 dark:hover:text-red-700"
					disabled={busy}
					onClick={() => setConfirming(true)}
				>
					{t("operations.bulk.delete")}
				</Button>
			</div>
			<ConfirmDialog
				open={confirming}
				onOpenChange={setConfirming}
				title={t("operations.bulk.deleteTitle", { count })}
				description={t("operations.bulk.deleteDescription", { count })}
				confirmLabel={t("operations.bulk.deleteTransactions", { count })}
				destructive
				pending={remove.isPending}
				onConfirm={() => void deleteAll()}
			/>
		</div>
	);
}
