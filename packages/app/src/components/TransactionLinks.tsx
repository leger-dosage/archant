import type { BillPrefill } from "@/components/BillDialog";
import type { TransactionData } from "@/hooks/useTransactions";
import type { TransferCandidateData } from "@/hooks/useTransfers";

import { Link } from "@tanstack/react-router";
import { MergeIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { BillDialog, prefillFrom } from "@/components/BillDialog";
import { DuplicateDialog } from "@/components/DuplicateDialog";
import { Money } from "@/components/Money";
import { PendingMergeDialog } from "@/components/PendingMergeDialog";
import { StatusBadge } from "@/components/StatusBadge";
import { TintedIcon } from "@/components/TintedIcon";
import { TransferDialog } from "@/components/TransferDialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccounts } from "@/hooks/useAccounts";
import {
	useDismissDuplicate,
	useDismissPostedMatch,
	useMergeDuplicate,
	useMergePending,
	usePostedMatch,
} from "@/hooks/useDuplicates";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useMerchants } from "@/hooks/useMerchants";
import {
	recurringName,
	useAddRecurring,
	useRecurringEnabled,
	useRecurringOfEntry,
} from "@/hooks/useRecurring";
import { useMatchTransfer, useRejectTransfer, useUnmatchTransfer } from "@/hooks/useTransfers";
import { accountsByName } from "@/lib/account-list";
import { errorCodeOf } from "@/lib/api";
import { dayAndMonth, longDate } from "@/lib/dates";
import { showErrorToast } from "@/lib/error-toast";
import { transferCaption } from "@/lib/transfers";

export type TransferLink = TransactionData["transfer"];

/**
 * The sheet's « Virement » block: « Rapprocher un virement » for a standard
 * transaction, then the other side, « Ne plus proposer » and « Dissocier »
 * for the transfer just made; a transfer row opens the transfer's drawer. It saves at once,
 * apart from the form, so it keeps the link it last saved rather than the row
 * the sheet was opened with. A viewer reads the link without its actions.
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
						counterpartCategoryId: candidate.categoryId,
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

/** What a pending block does once a merge or a dismissal settles, here or elsewhere. */
type PendingOutcomes = {
	onMerged: (survivorId: string) => void;
	/** Booked meanwhile, by a sync or another tab: nothing is left to merge. */
	onResolved: () => void;
	/** Merged away elsewhere meanwhile: nothing is left to edit. */
	onGone: () => void;
};

/**
 * A pending merge's refusal, as the sheet reacts to it: an entry booked or
 * merged elsewhere meanwhile hides what offered it, a line no longer a
 * candidate says so, anything else is the usual toast.
 */
function usePendingMergeFailure({ onResolved, onGone }: Omit<PendingOutcomes, "onMerged">) {
	const { t } = useTranslation();

	return (error: unknown, close: () => void) => {
		const code = errorCodeOf(error);

		if (code === "DUPLICATE_RESOLVED") {
			close();
			onResolved();
			toast.error(t("transactions.postedMatch.resolved"));

			return;
		}

		if (code === "NOT_FOUND") {
			close();
			onGone();
		}

		if (code === "VALIDATION_ERROR") {
			toast.error(t("transactions.pendingMerge.notCandidate"));
		} else {
			showErrorToast(code);
		}
	};
}

/**
 * The sheet's « Doublon possible détecté » alert, Sure's: the booked line a
 * sync suggests this pending transaction repeats at another amount, with
 * « Oui, fusionnez-les » and « Non, gardez les deux », which dismisses it for
 * good. Both save at once, apart from the form. Nothing shows until the line
 * is read, nor once it is gone. A viewer reads the alert without its actions.
 */
export function PostedMatchBlock({
	transaction,
	onDismissed,
	...outcomes
}: PendingOutcomes & { transaction: TransactionData; onDismissed: () => void }) {
	const { t } = useTranslation();
	const admin = useIsAdmin();
	const match = usePostedMatch(transaction.id, true);
	const mergePending = useMergePending();
	const dismissPostedMatch = useDismissPostedMatch();
	const failed = usePendingMergeFailure(outcomes);
	const line = match.data;

	if (line === undefined || line === null) {
		return null;
	}

	const busy = mergePending.isPending || dismissPostedMatch.isPending;

	return (
		<section
			aria-labelledby="transaction-posted-match-title"
			className="flex items-start gap-3 rounded-lg border border-warning bg-warning/6 p-4 dark:bg-warning/17"
		>
			<TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-warning" />
			<div className="flex min-w-0 flex-1 flex-col gap-2">
				<h3 id="transaction-posted-match-title" className="text-sm font-medium">
					{t("transactions.postedMatch.title")}
				</h3>
				<p className="text-sm text-muted-foreground">{t("transactions.postedMatch.description")}</p>
				<div className="flex items-center justify-between gap-4 rounded-md border bg-background p-3">
					<p className="flex min-w-0 flex-col">
						<span className="truncate text-sm font-medium">{line.label}</span>
						<span className="truncate text-xs text-muted-foreground">
							{longDate(line.date)} · {line.accountName}
						</span>
					</p>
					<Money amount={line.amount} currency={line.currency} signed />
				</div>
				{admin && (
					<div className="flex flex-wrap gap-2">
						<Button
							type="button"
							disabled={busy}
							onClick={() =>
								mergePending.mutate(
									{ id: transaction.id, into: line.id },
									{
										onSuccess: (survivor) => {
											toast.success(t("transactions.postedMatch.merged"));
											outcomes.onMerged(survivor.id);
										},
										onError: (error) => failed(error, () => undefined),
									},
								)
							}
						>
							{t("transactions.postedMatch.merge")}
						</Button>
						<Button
							type="button"
							variant="outline"
							disabled={busy}
							onClick={() =>
								dismissPostedMatch.mutate(transaction.id, {
									onSuccess: () => {
										toast.success(t("transactions.postedMatch.kept"));
										onDismissed();
									},
									onError: (error) => failed(error, () => undefined),
								})
							}
						>
							{t("transactions.postedMatch.keepBoth")}
						</Button>
					</div>
				)}
			</div>
		</section>
	);
}

/**
 * Sure's « Doublon d'une opération validée ? » on every pending
 * transaction, for an administrator: « Ouvrir la fusion » lists the booked
 * lines of its account to merge it into by hand.
 */
export function PendingMergeBlock({
	transaction,
	...outcomes
}: PendingOutcomes & { transaction: TransactionData }) {
	const { t } = useTranslation();
	const mergePending = useMergePending();
	const [picking, setPicking] = useState(false);
	const failed = usePendingMergeFailure(outcomes);

	const merge = (into: string) =>
		mergePending.mutate(
			{ id: transaction.id, into },
			{
				onSuccess: (survivor) => {
					setPicking(false);
					toast.success(t("transactions.pendingMerge.merged"));
					outcomes.onMerged(survivor.id);
				},
				onError: (error) => failed(error, () => setPicking(false)),
			},
		);

	return (
		<section
			aria-labelledby="transaction-pending-merge-title"
			className="flex items-center justify-between gap-4"
		>
			<div className="flex flex-col gap-1 text-sm">
				<h3 id="transaction-pending-merge-title" className="font-medium">
					{t("transactions.pendingMerge.title")}
				</h3>
				<p className="text-muted-foreground">{t("transactions.pendingMerge.description")}</p>
			</div>
			<Button type="button" variant="outline" className="shrink-0" onClick={() => setPicking(true)}>
				<MergeIcon aria-hidden="true" />
				{t("transactions.pendingMerge.open")}
			</Button>
			<PendingMergeDialog
				transaction={transaction}
				open={picking}
				onOpenChange={setPicking}
				onMerge={merge}
				pending={mergePending.isPending}
			/>
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
	// While recurring transactions are off, the bill pages lead home, as Sure's
	// `ensure_recurring_enabled`: neither the bill nor its declaration is offered.
	const bills = useRecurringEnabled();
	const merchants = useMerchants();
	const accounts = useAccounts({
		select: (data) =>
			accountsByName(data).filter(
				(account) => account.active || account.id === transaction.accountId,
			),
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
					{bills && (
						<Button variant="outline" asChild>
							<Link to="/bills/$billId" params={{ billId: series.data.id }} search={{}}>
								{t("transactions.recurring.open")}
							</Link>
						</Button>
					)}
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
						{bills && (
							<Button type="button" variant="outline" disabled={dirty} onClick={create}>
								{t("transactions.recurring.create")}
							</Button>
						)}
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
