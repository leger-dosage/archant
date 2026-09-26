import type { TransferCandidateData } from "@/hooks/useTransfers";

import { useTranslation } from "react-i18next";

import { Money } from "@/components/Money";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useTransferCandidates } from "@/hooks/useTransfers";
import { errorCodeOf } from "@/lib/api";
import { formatShortDate } from "@/lib/balance-change";

type TransferDialogProps = {
	transactionId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Saves the pick; the dialog closes once it is saved. */
	onPick: (candidate: TransferCandidateData) => void;
	pending: boolean;
};

/**
 * « Rapprocher un virement »: the transactions that can be the other side,
 * closest date first, one button each. Picking one is the whole action, as
 * a transfer is undone as easily with « Dissocier ».
 */
export function TransferDialog({
	transactionId,
	open,
	onOpenChange,
	onPick,
	pending,
}: TransferDialogProps) {
	const { t } = useTranslation();
	const candidates = useTransferCandidates(transactionId, open);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t("transactions.transfer.dialogTitle")}</DialogTitle>
					<DialogDescription>{t("transactions.transfer.dialogDescription")}</DialogDescription>
				</DialogHeader>
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
				{candidates.data?.length === 0 && (
					<p className="text-muted-foreground">{t("transactions.transfer.noCandidate")}</p>
				)}
				{candidates.data !== undefined && candidates.data.length > 0 && (
					<ul aria-label={t("transactions.transfer.candidates")} className="flex flex-col gap-1">
						{candidates.data.map((candidate) => (
							<li key={candidate.id}>
								<button
									type="button"
									disabled={pending}
									className="flex w-full items-center justify-between gap-4 rounded-md border px-3 py-2 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
									onClick={() => onPick(candidate)}
								>
									<span className="flex min-w-0 flex-col">
										<span className="truncate">{candidate.label}</span>
										<span className="truncate text-xs text-muted-foreground">
											{candidate.accountName} · {formatShortDate(candidate.date)}
										</span>
									</span>
									<Money amount={candidate.amount} currency={candidate.currency} signed />
								</button>
							</li>
						))}
					</ul>
				)}
			</DialogContent>
		</Dialog>
	);
}
