import type { Selection, SelectionTarget } from "@/hooks/useSelection";
import type { BulkSelectionInput } from "@/hooks/useTransactions";
import type { TransactionFilters } from "@/lib/transaction-filters";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { BulkEditSheet } from "@/components/BulkEditSheet";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useBulkDeleteTransactions } from "@/hooks/useTransactions";

// On the bar's dark background, as in the mockup.
const barButton = "text-background hover:bg-background/15 hover:text-background";

type BulkBarProps = {
	selection: Selection;
	target: SelectionTarget;
	/** How many rows the current filters match, on every page. */
	total: number;
	filters: TransactionFilters;
};

/** What the API receives: the ticked ids, or the filters for « every result ». */
function selectionBody(target: SelectionTarget, filters: TransactionFilters): BulkSelectionInput {
	return target.kind === "all" ? { filter: filters } : { ids: [...target.ids] };
}

/** The bar and its checkbox unmount once the selection clears; focus would fall to the page. */
const focusFirstRow = () => document.querySelector<HTMLElement>("[data-transaction-id]")?.focus();

/**
 * The actions on the ticked rows, shown at the bottom of `/transactions` while
 * one is ticked, as Sure's `_selection_bar`: a ticked checkbox that unticks
 * every row, as Sure's `bulk-select#deselectAll`, the count, « Tout
 * sélectionner », then « Modifier », which opens the bulk edit drawer, and
 * « Supprimer ». A success unticks every row and states the count; a failure
 * keeps them, with a destructive toast. No « Annuler », as in Sure: a wrong
 * bulk edit is fixed by another.
 */
export function BulkBar({ selection, target, total, filters }: BulkBarProps) {
	const { t } = useTranslation();
	const remove = useBulkDeleteTransactions();
	const [editing, setEditing] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const count = target.kind === "all" ? total : target.ids.length;
	const body = selectionBody(target, filters);

	// `mutateAsync` rather than `mutate`'s callbacks: the refetch after a
	// success can drop the ticked rows and unmount this bar, which would
	// silently skip them. The hook shows the failure toast.
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
			// Above the bottom navigation of narrow screens.
			className="sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] z-10 lg:bottom-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-foreground px-4 py-2 text-background shadow-lg"
		>
			<div className="flex items-center gap-2">
				<Checkbox
					checked
					aria-label={t("operations.bulk.clear")}
					// Inverted like the bar, so the tick reads in both themes. A 24 px
					// target, as WCAG 2.2 asks, rather than the 16 px box.
					className="after:-inset-1 data-checked:border-background data-checked:bg-background data-checked:text-foreground dark:data-checked:bg-background"
					onClick={(event) => {
						event.preventDefault();
						selection.clear();
						focusFirstRow();
					}}
				/>
				<p aria-live="polite" className="text-sm font-semibold whitespace-nowrap">
					{t("operations.bulk.selected", { count })}
				</p>
			</div>
			{target.kind !== "all" && count < total && (
				<Button
					variant="link"
					className="h-auto px-0 text-background/70 hover:text-background"
					onClick={selection.selectAll}
				>
					{t("operations.bulk.selectAll", { count: total })}
				</Button>
			)}
			<div className="flex flex-1 flex-wrap items-center justify-end gap-1">
				<Button
					variant="ghost"
					className={barButton}
					disabled={remove.isPending}
					onClick={() => setEditing(true)}
				>
					{t("operations.bulk.edit")}
				</Button>
				<Button
					variant="ghost"
					// The bar inverts the theme, so the red darkens where the bar turns light.
					// oxlint-disable-next-line shadcn/no-raw-colors
					className="text-red-400 hover:bg-background/15 hover:text-red-300 dark:text-red-600 dark:hover:text-red-700"
					disabled={remove.isPending}
					onClick={() => setConfirming(true)}
				>
					{t("operations.bulk.delete")}
				</Button>
			</div>
			<BulkEditSheet
				open={editing}
				onOpenChange={setEditing}
				selection={body}
				onSaved={(updated) => {
					selection.clear();
					toast.success(t("operations.bulk.updated", { count: updated }));
					focusFirstRow();
				}}
			/>
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
