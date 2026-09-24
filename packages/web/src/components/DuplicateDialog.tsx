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
import { useDuplicateCandidates } from "@/hooks/useDuplicates";
import { errorCodeOf } from "@/lib/api";
import { formatShortDate } from "@/lib/balance-change";

type DuplicateDialogProps = {
	transactionId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Merges into the candidate picked; the caller closes the dialog once it is saved. */
	onMerge: (candidateId: string) => void;
	pending: boolean;
};

/**
 * « Fusionner avec… »: the transactions this one may repeat, nearest date
 * first. Unlike a transfer, a merge deletes a row for good, so the pick and
 * « Fusionner » are two steps, under a description saying which row goes.
 */
export function DuplicateDialog({
	transactionId,
	open,
	onOpenChange,
	onMerge,
	pending,
}: DuplicateDialogProps) {
	const { t } = useTranslation();
	const candidates = useDuplicateCandidates(transactionId, open);
	const [picked, setPicked] = useState<string | null>(null);
	const chosen = candidates.data?.find((candidate) => candidate.id === picked);

	useEffect(() => {
		if (open) {
			setPicked(null);
		}
	}, [open]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t("transactions.duplicate.dialogTitle")}</DialogTitle>
					<DialogDescription>{t("transactions.duplicate.dialogDescription")}</DialogDescription>
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
					<p className="text-muted-foreground">{t("transactions.duplicate.noCandidate")}</p>
				)}
				{candidates.data !== undefined && candidates.data.length > 0 && (
					<fieldset className="flex flex-col gap-1">
						<legend className="sr-only">{t("transactions.duplicate.candidates")}</legend>
						{candidates.data.map((candidate) => (
							<label
								key={candidate.id}
								className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 hover:bg-muted has-checked:border-ring has-checked:bg-muted has-focus-visible:ring-2 has-focus-visible:ring-ring"
							>
								<input
									type="radio"
									name="duplicate-candidate"
									value={candidate.id}
									checked={picked === candidate.id}
									disabled={pending}
									onChange={() => setPicked(candidate.id)}
									className="size-4 shrink-0 accent-primary outline-none"
								/>
								<span className="flex min-w-0 flex-1 flex-col">
									<span className="truncate">{candidate.label}</span>
									<span className="truncate text-xs text-muted-foreground">
										{candidate.accountName} · {formatShortDate(candidate.date)}
									</span>
								</span>
								<Money amount={candidate.amount} currency={candidate.currency} signed />
							</label>
						))}
					</fieldset>
				)}
				<DialogFooter>
					<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
						{t("common.cancel")}
					</Button>
					<Button
						type="button"
						disabled={chosen === undefined || pending}
						onClick={() => {
							if (chosen !== undefined) {
								onMerge(chosen.id);
							}
						}}
					>
						{t("transactions.duplicate.merge")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
