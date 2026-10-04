import type { SplitData, TransactionData } from "@/hooks/useTransactions";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { CurrencyCode } from "@archant/data/money";
import { formatMoney } from "@archant/data/money";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Money } from "@/components/Money";
import { SplitDialog } from "@/components/SplitDialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAttachmentCount } from "@/hooks/useAttachments";
import { useCategoryShown } from "@/hooks/useCategories";
import { useSplit, useUnsplitTransaction } from "@/hooks/useTransactions";
import { errorCodeOf } from "@/lib/api";
import { formatShortDate } from "@/lib/balance-change";
import { showErrorToast } from "@/lib/error-toast";

/** One line of a split as its parent's sheet lists it: label, category and amount. */
function SplitLineItem({ line }: { line: SplitData["children"][number] }) {
	const { name } = useCategoryShown(line.categoryId);

	return (
		<li className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
			<div className="flex min-w-0 flex-col">
				<span className="truncate text-sm font-medium">{line.label}</span>
				<div className="truncate text-xs text-muted-foreground">
					{name ?? <Skeleton className="h-3 w-20" />}
				</div>
			</div>
			<Money amount={line.amount} currency={line.currency} signed />
		</li>
	);
}

/**
 * « Modifier la division » and « Annuler la division », from the parent's
 * sheet or a line's, as Sure's: both act on the whole split.
 */
function SplitActions({
	split,
	currency,
	disabled,
	onDone,
}: {
	split: SplitData;
	currency: CurrencyCode;
	disabled: boolean;
	onDone: (rowId: string) => void;
}) {
	const { t } = useTranslation();
	const unsplit = useUnsplitTransaction();
	const [editing, setEditing] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const { parent } = split;
	// Undoing deletes the lines with their receipts, as Sure's purge: the
	// confirmation says how many, read when it opens.
	const lineAttachments = useAttachmentCount(
		split.children.map((line) => line.id),
		confirming,
	);

	const undo = () =>
		unsplit.mutate(parent.id, {
			onSuccess: (restored) => {
				setConfirming(false);
				toast.success(t("transactions.split.undone"));
				onDone(restored.id);
			},
			onError: (error) => {
				setConfirming(false);
				showErrorToast(errorCodeOf(error));
			},
		});

	return (
		<div className="flex flex-wrap gap-2">
			<Button type="button" variant="outline" disabled={disabled} onClick={() => setEditing(true)}>
				{t("transactions.split.edit")}
			</Button>
			<Button
				type="button"
				variant="outline"
				disabled={disabled || unsplit.isPending}
				onClick={() => setConfirming(true)}
			>
				{t("transactions.split.undo")}
			</Button>
			<SplitDialog
				open={editing}
				onOpenChange={setEditing}
				parent={parent}
				currency={currency}
				lines={split.children}
				onSaved={onDone}
			/>
			<ConfirmDialog
				open={confirming}
				onOpenChange={setConfirming}
				title={t("transactions.split.undoTitle")}
				description={[
					t("transactions.split.undoDescription", {
						label: parent.label,
						amount: formatMoney({ amount: parent.amount, currency: parent.currency }),
					}),
					...(lineAttachments.count === 0
						? []
						: [t("transactions.split.undoAttachments", { count: lineAttachments.count })]),
				].join(" ")}
				confirmLabel={t("transactions.split.undo")}
				cancelLabel={t("transactions.split.keep")}
				destructive
				pending={unsplit.isPending || lineAttachments.loading}
				onConfirm={undo}
			/>
		</div>
	);
}

/**
 * The sheet's « Division » block, as Sure's: a parent lists its lines, a
 * line names its parent, both with the split's actions; a transaction that
 * can be split offers « Diviser ». Every action saves at once, apart from
 * the form, so it waits while the form holds unsaved edits, as the
 * recurring block does.
 */
export function SplitBlock({
	transaction,
	currency,
	splittable,
	dirty,
	onDone,
}: {
	transaction: TransactionData;
	currency: CurrencyCode;
	/** Neither a transfer side, pending, excluded nor a possible duplicate. */
	splittable: boolean;
	dirty: boolean;
	/** After a split, its edit or its undoing: the sheet closes on the parent's row. */
	onDone: (rowId: string) => void;
}) {
	const { t } = useTranslation();
	const inSplit = transaction.splitParent || transaction.parentEntryId !== null;
	const split = useSplit(transaction.id, inSplit);
	const [splitting, setSplitting] = useState(false);

	if (!inSplit && !splittable) {
		return null;
	}

	return (
		<section aria-labelledby="transaction-split-title" className="flex flex-col gap-1.5">
			<h3 id="transaction-split-title" className="text-sm font-medium">
				{t("transactions.split.section")}
			</h3>
			{!inSplit ? (
				<div className="flex flex-col items-start gap-2">
					<p className="text-sm text-muted-foreground">{t("transactions.split.offer")}</p>
					<Button
						type="button"
						variant="outline"
						disabled={dirty}
						onClick={() => setSplitting(true)}
					>
						{t("transactions.split.submit")}
					</Button>
					<SplitDialog
						open={splitting}
						onOpenChange={setSplitting}
						parent={transaction}
						currency={currency}
						lines={null}
						onSaved={onDone}
					/>
				</div>
			) : split.isPending ? (
				<Skeleton className="h-20 w-full" />
			) : split.isError ? (
				<p role="alert" className="text-sm text-muted-foreground">
					{t(`errors.${errorCodeOf(split.error)}`)}
				</p>
			) : (
				<div className="flex flex-col items-start gap-2">
					{transaction.splitParent ? (
						<>
							<p className="text-sm text-muted-foreground">
								{t("transactions.split.parentDescription", { count: split.data.children.length })}
							</p>
							<ul
								aria-label={t("transactions.split.lines", { label: split.data.parent.label })}
								className="flex w-full flex-col gap-1.5"
							>
								{split.data.children.map((line) => (
									<SplitLineItem key={line.id} line={line} />
								))}
							</ul>
						</>
					) : (
						<p className="text-sm text-muted-foreground">
							{t("transactions.split.childDescription", {
								label: split.data.parent.label,
								date: formatShortDate(split.data.parent.date),
								amount: formatMoney({
									amount: split.data.parent.amount,
									currency: split.data.parent.currency,
								}),
							})}
						</p>
					)}
					<SplitActions split={split.data} currency={currency} disabled={dirty} onDone={onDone} />
				</div>
			)}
		</section>
	);
}
