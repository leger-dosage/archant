import type { BillDialogSubject } from "@/components/BillDialog";
import type { RecurringData } from "@/hooks/useRecurring";
import type { ReactNode } from "react";

import { EllipsisIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { BillDialog } from "@/components/BillDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAccounts } from "@/hooks/useAccounts";
import { recurringName, useDeleteRecurring, useSetRecurringStatus } from "@/hooks/useRecurring";
import { errorCodeOf } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";

/** What a bill's actions read of it. */
type Bill = RecurringData;

export type BillActions = {
	/** « Ajouter une facture » or « Ajouter un revenu ». */
	declare: (kind: "bill" | "income") => void;
	edit: (bill: Bill) => void;
	/** « Mettre en pause » an active bill, « Reprendre » any other. */
	toggle: (bill: Bill) => void;
	/** Asks first, then deletes a manual bill or ends a detected one. */
	remove: (bill: Bill) => void;
	/** A suggestion's « Ajouter la facture » (`active`) or « Ce n'est pas une facture » (`ended`). */
	settle: (bill: Bill, status: "active" | "ended") => void;
	pending: boolean;
	/** The dialogs the actions open, to render once beside them. */
	dialogs: ReactNode;
};

/**
 * Sure's bill actions, shared by « Toutes les factures » and a bill's
 * drawer: the declare and edit dialog, pause or resume, and delete after a
 * confirmation. `onDeleted` runs once a delete succeeds.
 */
export function useBillActions(onDeleted?: () => void): BillActions {
	const { t } = useTranslation();
	const setStatus = useSetRecurringStatus();
	const removal = useDeleteRecurring();
	// Kept while the dialog closes, so its title does not vanish mid-animation.
	const [deleting, setDeleting] = useState<Bill | null>(null);
	const [deleteOpen, setDeleteOpen] = useState(false);
	// Kept while the dialog closes, as `deleting`; the key mounts a fresh form per opening.
	const [subject, setSubject] = useState<{ key: number; of: BillDialogSubject } | null>(null);
	const [billOpen, setBillOpen] = useState(false);
	const accounts = useAccounts({
		select: (data) => data.groups.flatMap((group) => group.accounts),
	});
	// A series may sit on an account deactivated since: it stays offered for it.
	const offered = useMemo(() => {
		const own = subject?.of.mode === "edit" ? subject.of.series.accountId : null;

		return (accounts.data ?? []).filter((account) => account.active || account.id === own);
	}, [accounts.data, subject]);
	const open = (of: BillDialogSubject) => {
		setSubject((current) => ({ key: (current?.key ?? 0) + 1, of }));
		setBillOpen(true);
	};

	const toggle = (bill: Bill) => {
		const status = bill.status === "active" ? "inactive" : "active";

		setStatus.mutate(
			{ id: bill.id, status },
			{
				onSuccess: () =>
					toast.success(t(status === "active" ? "recurring.resumed" : "recurring.paused")),
				onError: (error) => showErrorToast(errorCodeOf(error)),
			},
		);
	};

	const settle = (bill: Bill, status: "active" | "ended") =>
		setStatus.mutate(
			{ id: bill.id, status },
			{
				onSuccess: () =>
					toast.success(
						t(status === "active" ? "recurring.suggested.added" : "recurring.suggested.dismissed"),
					),
				onError: (error) => showErrorToast(errorCodeOf(error)),
			},
		);

	const dialogs = (
		<>
			{subject !== null && (
				<BillDialog
					key={subject.key}
					open={billOpen}
					onOpenChange={setBillOpen}
					subject={subject.of}
					accounts={offered}
				/>
			)}

			{deleting !== null && (
				<ConfirmDialog
					open={deleteOpen}
					onOpenChange={setDeleteOpen}
					title={t("recurring.deleteDialog.title", { name: recurringName(deleting) })}
					// A manual series is deleted, so detection may find its pattern again;
					// a detected one is ended and never offered again.
					description={t(
						deleting.manual
							? "recurring.deleteDialog.descriptionManual"
							: "recurring.deleteDialog.description",
					)}
					confirmLabel={t("recurring.deleteDialog.action")}
					destructive
					pending={removal.isPending}
					onConfirm={() =>
						removal.mutate(deleting.id, {
							onSuccess: () => {
								toast.success(t("recurring.deleteDialog.deleted"));
								setDeleteOpen(false);
								onDeleted?.();
							},
							onError: (error) => {
								showErrorToast(errorCodeOf(error));
								setDeleteOpen(false);
							},
						})
					}
				/>
			)}
		</>
	);

	return {
		declare: (kind) => open({ mode: "declare", kind, prefill: null }),
		edit: (bill) => open({ mode: "edit", series: bill }),
		toggle,
		settle,
		remove: (bill) => {
			setDeleting(bill);
			setDeleteOpen(true);
		},
		pending: setStatus.isPending || removal.isPending,
		dialogs,
	};
}

/**
 * « Supprimer » deletes a manual bill and ends a detected one, so a detected
 * bill already ended has nothing left for it to do.
 */
export const canDelete = (bill: Pick<Bill, "manual" | "status">) =>
	bill.manual || bill.status !== "ended";

/** A bill's row menu: « Modifier », « Mettre en pause » or « Reprendre », « Supprimer ». */
export function BillMenu({ bill, actions }: { bill: Bill; actions: BillActions }) {
	const { t } = useTranslation();

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					aria-label={t("recurring.actions", { name: recurringName(bill) })}
				>
					<EllipsisIcon />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem onSelect={() => actions.edit(bill)}>
					{t("recurring.edit")}
				</DropdownMenuItem>
				<DropdownMenuItem disabled={actions.pending} onSelect={() => actions.toggle(bill)}>
					{t(bill.status === "active" ? "recurring.pause" : "recurring.resume")}
				</DropdownMenuItem>
				{canDelete(bill) && (
					<DropdownMenuItem
						variant="destructive"
						disabled={actions.pending}
						onSelect={() => actions.remove(bill)}
					>
						{t("recurring.delete")}
					</DropdownMenuItem>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
