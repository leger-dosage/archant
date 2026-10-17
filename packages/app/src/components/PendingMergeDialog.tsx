import type { TransactionData } from "@/hooks/useTransactions";

import { ArrowDownIcon, ClockIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Money } from "@/components/Money";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccounts } from "@/hooks/useAccounts";
import { usePendingMergeCandidates } from "@/hooks/useDuplicates";
import { accountsByName } from "@/lib/account-list";
import { errorCodeOf } from "@/lib/api";
import { formatShortDate } from "@/lib/balance-change";
import { longDate } from "@/lib/dates";

/** Sure's `@limit`: the page the API answers, and the step of its two links. */
const PAGE_SIZE = 10;

type PendingMergeDialogProps = {
	transaction: TransactionData;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Merges into the booked line picked; the caller closes the dialog once it is saved. */
	onMerge: (bookedId: string) => void;
	pending: boolean;
};

/**
 * Sure's « Fusionner avec une opération validée »: the pending transaction
 * above the booked lines of its account, ten at a time, the latest first.
 * The pick and « Fusionner les opérations » are two steps, as a merge
 * deletes the pending row for good.
 */
export function PendingMergeDialog({
	transaction,
	open,
	onOpenChange,
	onMerge,
	pending,
}: PendingMergeDialogProps) {
	const { t } = useTranslation();
	const [offset, setOffset] = useState(0);
	const [picked, setPicked] = useState<string | null>(null);
	const candidates = usePendingMergeCandidates(transaction.id, offset, open);
	const accountName = useAccounts({
		select: (data) =>
			accountsByName(data).find((account) => account.id === transaction.accountId)?.name,
	}).data;
	const shown = candidates.data?.candidates ?? [];
	// The page on screen, the previous one while the next loads.
	const shownOffset = candidates.data?.offset ?? offset;
	const chosen = shown.some(({ id }) => id === picked) ? picked : null;
	const turnTo = (next: number) => {
		setPicked(null);
		setOffset(next);
	};

	useEffect(() => {
		if (open) {
			setOffset(0);
			setPicked(null);
		}
	}, [open]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t("transactions.pendingMerge.dialogTitle")}</DialogTitle>
				</DialogHeader>
				<div className="flex items-start gap-3 rounded-lg border border-warning/20 bg-warning/6 p-4 text-sm dark:bg-warning/17">
					<TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-warning" />
					<div className="flex flex-col gap-2">
						<p className="font-medium">{t("transactions.pendingMerge.warningTitle")}</p>
						<DialogDescription>
							{t("transactions.pendingMerge.warningDescription")}
						</DialogDescription>
					</div>
				</div>
				<section aria-labelledby="pending-merge-source" className="flex flex-col gap-2">
					<h3
						id="pending-merge-source"
						className="inline-flex items-center gap-1 text-sm font-medium"
					>
						<ClockIcon aria-hidden="true" className="size-4" />
						{t("transactions.pendingMerge.pendingTransaction")}
					</h3>
					<div className="flex flex-col gap-1 rounded-lg border bg-muted p-4">
						<p className="font-medium">{transaction.label}</p>
						<p className="text-xs text-muted-foreground">
							{accountName === undefined ? "" : `${accountName} · `}
							{longDate(transaction.date)} ·{" "}
							<Money amount={transaction.amount} currency={transaction.currency} signed />
						</p>
					</div>
				</section>
				<ArrowDownIcon aria-hidden="true" className="mx-auto size-5 text-muted-foreground" />
				{candidates.isPending && (
					<div className="flex flex-col gap-2" aria-hidden="true">
						<Skeleton className="h-12 w-full" />
						<Skeleton className="h-12 w-full" />
					</div>
				)}
				{candidates.isError && (
					<p role="alert" className="text-muted-foreground">
						{t(`errors.${errorCodeOf(candidates.error)}`)}
					</p>
				)}
				{candidates.data !== undefined && shown.length === 0 && (
					<p className="rounded-lg border bg-muted p-4 text-center text-muted-foreground">
						{t("transactions.pendingMerge.noCandidates")}
					</p>
				)}
				{shown.length > 0 && (
					<fieldset className="flex flex-col gap-1">
						<legend className="mb-2 text-sm font-medium">
							{t("transactions.pendingMerge.selectPosted")}
						</legend>
						<div className="flex max-h-96 flex-col gap-1 overflow-y-auto">
							{shown.map((candidate) => (
								<label
									key={candidate.id}
									className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 hover:bg-muted has-checked:border-ring has-checked:bg-muted has-focus-visible:ring-2 has-focus-visible:ring-ring"
								>
									<input
										type="radio"
										name="pending-merge-candidate"
										value={candidate.id}
										checked={picked === candidate.id}
										disabled={pending}
										onChange={() => setPicked(candidate.id)}
										className="size-4 shrink-0 accent-primary outline-none"
									/>
									<span className="flex min-w-0 flex-1 flex-col">
										<span className="truncate">{candidate.label}</span>
										<span className="truncate text-xs text-muted-foreground">
											{formatShortDate(candidate.date)}
										</span>
									</span>
									<Money amount={candidate.amount} currency={candidate.currency} signed />
								</label>
							))}
						</div>
					</fieldset>
				)}
				{/* Kept on an empty page past the first, so « ← 10 précédentes » leads back. */}
				{candidates.data !== undefined && (shown.length > 0 || shownOffset > 0) && (
					<div className="flex items-center justify-between gap-2">
						<p className="text-xs text-muted-foreground">
							{shown.length > 0 &&
								t("transactions.pendingMerge.showingRange", {
									start: shownOffset + 1,
									end: shownOffset + shown.length,
								})}
						</p>
						<div className="flex gap-2">
							{shownOffset > 0 && (
								<Button
									type="button"
									variant="link"
									size="sm"
									disabled={candidates.isFetching}
									onClick={() => turnTo(Math.max(shownOffset - PAGE_SIZE, 0))}
								>
									{t("transactions.pendingMerge.previous")}
								</Button>
							)}
							{candidates.data.hasMore && (
								<Button
									type="button"
									variant="link"
									size="sm"
									disabled={candidates.isFetching}
									onClick={() => turnTo(shownOffset + PAGE_SIZE)}
								>
									{t("transactions.pendingMerge.next")}
								</Button>
							)}
						</div>
					</div>
				)}
				<DialogFooter>
					<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
						{t("common.cancel")}
					</Button>
					{shown.length > 0 && (
						<Button
							type="button"
							disabled={chosen === null || pending}
							onClick={() => {
								if (chosen !== null) {
									onMerge(chosen);
								}
							}}
						>
							{t("transactions.pendingMerge.submit")}
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
