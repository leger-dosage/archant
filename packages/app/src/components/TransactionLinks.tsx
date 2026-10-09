import type { BillPrefill } from "@/components/BillDialog";
import type { TransactionData } from "@/hooks/useTransactions";
import type { TransferCandidateData } from "@/hooks/useTransfers";

import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { BillDialog, prefillFrom } from "@/components/BillDialog";
import { DuplicateDialog } from "@/components/DuplicateDialog";
import { StatusBadge } from "@/components/StatusBadge";
import { TintedIcon } from "@/components/TintedIcon";
import { TransferDialog } from "@/components/TransferDialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccounts } from "@/hooks/useAccounts";
import { useDismissDuplicate, useMergeDuplicate } from "@/hooks/useDuplicates";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useMerchants } from "@/hooks/useMerchants";
import { recurringName, useAddRecurring, useRecurringOfEntry } from "@/hooks/useRecurring";
import { useMatchTransfer, useRejectTransfer, useUnmatchTransfer } from "@/hooks/useTransfers";
import { errorCodeOf } from "@/lib/api";
import { dayAndMonth } from "@/lib/dates";
import { showErrorToast } from "@/lib/error-toast";
import { transferCaption } from "@/lib/transfers";

export type TransferLink = TransactionData["transfer"];

/**
 * The sheet's « Virement » block: the other side, « Ne plus proposer » and
 * « Dissocier » for a transfer side, « Rapprocher un virement » for a standard
 * transaction. It saves at once, apart from the form, so it keeps the link
 * it last saved rather than the row the sheet was opened with. A viewer
 * reads the link without its actions.
 */
export function TransferBlock({
	transaction,
	transfer,
	onChange,
}: {
	transaction: TransactionData;
	transfer: TransferLink;
	onChange: (transfer: TransferLink) => void;
}) {
	const { t } = useTranslation();
	const admin = useIsAdmin();
	const matchTransfer = useMatchTransfer();
	const unmatchTransfer = useUnmatchTransfer();
	const rejectTransfer = useRejectTransfer();
	const [picking, setPicking] = useState(false);
	const caption = transferCaption({ amount: transaction.amount, transfer });

	const match = (candidate: TransferCandidateData) =>
		matchTransfer.mutate(
			{ transactionId: transaction.id, counterpartId: candidate.id },
			{
				onSuccess: (saved) => {
					onChange({
						id: saved.id,
						kind: saved.kind,
						status: saved.status,
						counterpartTransactionId: candidate.id,
						counterpartAccountId: candidate.accountId,
						counterpartAccountName: candidate.accountName,
					});
					setPicking(false);
					toast.success(t("transactions.transfer.matched"));
				},
				onError: (error) => showErrorToast(errorCodeOf(error)),
			},
		);

	const undo = (
		mutation: typeof unmatchTransfer,
		id: string,
		done: "transactions.transfer.unmatched" | "transactions.transfer.rejected",
	) =>
		mutation.mutate(id, {
			onSuccess: () => {
				onChange(null);
				toast.success(t(done));
			},
			onError: (error) => {
				// Already dissociated elsewhere: the sheet catches up rather than
				// offering « Dissocier » again.
				if (errorCodeOf(error) === "NOT_FOUND") {
					onChange(null);
				}
				showErrorToast(errorCodeOf(error));
			},
		});
	const pending = unmatchTransfer.isPending || rejectTransfer.isPending;

	return (
		<section aria-labelledby="transaction-transfer-title" className="flex flex-col gap-1.5">
			<h3 id="transaction-transfer-title" className="text-sm font-medium">
				{t("transactions.transfer.title")}
			</h3>
			{transfer === null || caption === null ? (
				<div className="flex flex-col items-start gap-2">
					<p className="text-sm text-muted-foreground">{t("transactions.transfer.none")}</p>
					{admin && (
						<>
							<Button type="button" variant="outline" onClick={() => setPicking(true)}>
								{t("transactions.transfer.match")}
							</Button>
							<TransferDialog
								transactionId={transaction.id}
								open={picking}
								onOpenChange={setPicking}
								onPick={match}
								pending={matchTransfer.isPending}
							/>
						</>
					)}
				</div>
			) : (
				<div className="flex items-center justify-between gap-4">
					<p className="flex min-w-0 flex-col text-sm">
						<span className="truncate">{t(caption.key, { account: caption.account })}</span>
						<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
							<TintedIcon subject={{ kind: "transfer" }} size="sm" />
							{t(`transactions.transfer.kinds.${transfer.kind}`)}
						</span>
					</p>
					{admin && (
						<div className="flex shrink-0 gap-2">
							<Button
								type="button"
								variant="outline"
								disabled={pending}
								onClick={() => undo(rejectTransfer, transfer.id, "transactions.transfer.rejected")}
							>
								{t("transactions.transfer.reject")}
							</Button>
							<Button
								type="button"
								variant="outline"
								disabled={pending}
								onClick={() =>
									undo(unmatchTransfer, transfer.id, "transactions.transfer.unmatched")
								}
							>
								{t("transactions.transfer.unmatch")}
							</Button>
						</div>
					)}
				</div>
			)}
		</section>
	);
}

/**
 * The sheet's « Doublon possible » block, shown while the flag holds:
 * « Fusionner avec… » deletes this transaction into the one picked, and
 * « Ce n'est pas un doublon » clears the flag. Both save at once, apart from
 * the form, as the transfer block does. A merge or a dismissal made in
 * another tab hides the block rather than offering it again. A viewer reads
 * the flag without its actions.
 */
export function DuplicateBlock({
	transaction,
	onDismissed,
	onMerged,
	onResolved,
	onGone,
}: {
	transaction: TransactionData;
	onDismissed: () => void;
	onMerged: (survivorId: string) => void;
	/** Dismissed elsewhere meanwhile. */
	onResolved: () => void;
	/** Merged away elsewhere meanwhile: nothing is left to edit. */
	onGone: () => void;
}) {
	const { t } = useTranslation();
	const admin = useIsAdmin();
	const mergeDuplicate = useMergeDuplicate();
	const dismissDuplicate = useDismissDuplicate();
	const [picking, setPicking] = useState(false);

	const failed = (error: unknown) => {
		const code = errorCodeOf(error);

		if (code === "DUPLICATE_RESOLVED") {
			setPicking(false);
			onResolved();
		}

		if (code === "NOT_FOUND") {
			setPicking(false);
			onGone();
		}

		if (code === "VALIDATION_ERROR") {
			// The candidate changed meanwhile; the list refreshes with the mutation.
			toast.error(t("transactions.duplicate.notCandidate"));
		} else {
			showErrorToast(code);
		}
	};

	const merge = (into: string) =>
		mergeDuplicate.mutate(
			{ id: transaction.id, into },
			{
				onSuccess: (survivor) => {
					setPicking(false);
					toast.success(t("transactions.duplicate.merged"));
					onMerged(survivor.id);
				},
				onError: failed,
			},
		);

	const dismiss = () =>
		dismissDuplicate.mutate(transaction.id, {
			onSuccess: () => {
				toast.success(t("transactions.duplicate.dismissed"));
				onDismissed();
			},
			onError: failed,
		});

	return (
		<section aria-labelledby="transaction-duplicate-title" className="flex flex-col gap-1.5">
			<h3 id="transaction-duplicate-title" className="text-sm font-medium">
				<StatusBadge status="duplicate" />
			</h3>
			<p className="text-sm text-muted-foreground">{t("transactions.duplicate.description")}</p>
			{admin && (
				<>
					<div className="flex flex-wrap gap-2">
						<Button
							type="button"
							variant="outline"
							disabled={dismissDuplicate.isPending}
							onClick={() => setPicking(true)}
						>
							{t("transactions.duplicate.mergeWith")}
						</Button>
						<Button
							type="button"
							variant="outline"
							disabled={mergeDuplicate.isPending || dismissDuplicate.isPending}
							onClick={dismiss}
						>
							{t("transactions.duplicate.dismiss")}
						</Button>
					</div>
					<DuplicateDialog
						transactionId={transaction.id}
						open={picking}
						onOpenChange={setPicking}
						onMerge={merge}
						pending={mergeDuplicate.isPending}
					/>
				</>
			)}
		</section>
	);
}

/**
 * The sheet's « Récurrence » block: names the series the saved transaction
 * belongs to, with a link to the page, or else adds it to the recurring
 * patterns, active, at once and apart from the form, as the transfer
 * block does, or opens « Créer une facture » filled from it, as Sure's
 * `prefill_recurring_from_entry`. Hidden on a transfer side the API refuses.
 * A viewer reads whether it belongs to a series, and adds none.
 */
export function RecurringBlock({
	transaction,
	dirty,
}: {
	transaction: TransactionData;
	/** Unsaved edits: the API would read the saved row, not what the form shows. */
	dirty: boolean;
}) {
	const { t } = useTranslation();
	const admin = useIsAdmin();
	const series = useRecurringOfEntry(transaction.id);
	const addRecurring = useAddRecurring();
	const merchants = useMerchants();
	const accounts = useAccounts({
		select: (data) =>
			data.groups
				.flatMap((group) => group.accounts)
				.filter((account) => account.active || account.id === transaction.accountId),
	});
	// Kept while the dialog closes; the key mounts a fresh form per opening.
	const [prefill, setPrefill] = useState<{ key: number; of: BillPrefill } | null>(null);
	const [creating, setCreating] = useState(false);
	const create = () => {
		const merchant = merchants.data?.find((candidate) => candidate.id === transaction.merchantId);

		setPrefill((current) => ({
			key: (current?.key ?? 0) + 1,
			of: prefillFrom({
				id: transaction.id,
				name: merchant?.name ?? transaction.label,
				amount: transaction.amount,
				currency: transaction.currency,
				accountId: transaction.accountId,
				date: transaction.date,
			}),
		}));
		setCreating(true);
	};

	return (
		<section aria-labelledby="transaction-recurring-title" className="flex flex-col gap-1.5">
			<h3 id="transaction-recurring-title" className="text-sm font-medium">
				{t("transactions.recurring.title")}
			</h3>
			{series.isPending ? (
				<Skeleton className="h-9 w-full" />
			) : series.data ? (
				<div className="flex flex-col items-start gap-2">
					<p className="text-sm text-muted-foreground">
						{series.data.pays === null
							? t("transactions.recurring.member", { name: recurringName(series.data) })
							: t("transactions.recurring.pays", {
									date: dayAndMonth(series.data.pays.dueOn),
									name: recurringName(series.data),
								})}
					</p>
					<Button variant="outline" asChild>
						<Link to="/bills/$billId" params={{ billId: series.data.id }} search={{}}>
							{t("transactions.recurring.open")}
						</Link>
					</Button>
				</div>
			) : !admin ? (
				<p className="text-sm text-muted-foreground">{t("transactions.recurring.none")}</p>
			) : (
				<div className="flex flex-col items-start gap-2">
					<p className="text-sm text-muted-foreground">{t("transactions.recurring.description")}</p>
					<div className="flex flex-wrap gap-2">
						<Button
							type="button"
							variant="outline"
							disabled={dirty || addRecurring.isPending}
							onClick={() =>
								addRecurring.mutate(transaction.id, {
									onSuccess: () => toast.success(t("transactions.recurring.added")),
									onError: (error) => showErrorToast(errorCodeOf(error)),
								})
							}
						>
							{t("transactions.recurring.add")}
						</Button>
						<Button type="button" variant="outline" disabled={dirty} onClick={create}>
							{t("transactions.recurring.create")}
						</Button>
					</div>
				</div>
			)}
			{prefill !== null && (
				<BillDialog
					key={prefill.key}
					open={creating}
					onOpenChange={setCreating}
					subject={{ mode: "declare", kind: prefill.of.kind, prefill: prefill.of }}
					accounts={accounts.data ?? []}
				/>
			)}
		</section>
	);
}
