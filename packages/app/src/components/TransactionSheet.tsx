import type { SheetAccount } from "@/components/TransactionForm";
import type { TransactionData } from "@/hooks/useTransactions";

import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { TransactionForm } from "@/components/TransactionForm";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { formatShortDate } from "@/lib/balance-change";

/** A row's button in the page, found again after a refetch remounted it. */
const rowById = (id: string) =>
	document.querySelector<HTMLElement>(`[data-transaction-id="${CSS.escape(id)}"]`);

type TransactionSheetProps = {
	account: SheetAccount;
	open: boolean;
	/** `null` to add a new transaction. */
	transaction: TransactionData | null;
	onOpenChange: (open: boolean) => void;
};

/**
 * Adds or edits one transaction. Saves on `⌘Enter` or Enregistrer; `Esc`,
 * Annuler and the close button ask before throwing away unsaved changes, and
 * only then (EXPERIENCE.md). Focus goes back to what opened it.
 */
export function TransactionSheet({
	account,
	open,
	transaction,
	onOpenChange,
}: TransactionSheetProps) {
	const { t } = useTranslation();
	const [confirmingDiscard, setConfirmingDiscard] = useState(false);
	const [session, setSession] = useState(0);
	const [wasOpen, setWasOpen] = useState(open);

	if (open !== wasOpen) {
		setWasOpen(open);
		if (open) {
			setSession((current) => current + 1);
		}
	}

	// Read only when the sheet is asked to close, so a ref rather than state.
	const dirty = useRef(false);
	// Radix returns focus to a `SheetTrigger`; this sheet is opened from rows
	// and buttons of the page instead, so it remembers which one itself.
	const opener = useRef<HTMLElement | null>(null);
	// A merge deletes the row that opened the sheet: focus goes to the survivor's.
	const survivor = useRef<string | null>(null);
	const setDirty = useCallback((value: boolean) => {
		dirty.current = value;
	}, []);

	const requestClose = () => {
		if (dirty.current) {
			setConfirmingDiscard(true);
		} else {
			onOpenChange(false);
		}
	};

	return (
		<Sheet
			open={open}
			onOpenChange={(next) => {
				if (next) {
					onOpenChange(true);
				} else {
					requestClose();
				}
			}}
		>
			<SheetContent
				onOpenAutoFocus={() => {
					opener.current =
						document.activeElement instanceof HTMLElement ? document.activeElement : null;
				}}
				onCloseAutoFocus={(event) => {
					const id = opener.current?.dataset["transactionId"];
					const target =
						survivor.current !== null
							? rowById(survivor.current)
							: opener.current?.isConnected === true || id === undefined
								? opener.current
								: rowById(id);
					survivor.current = null;

					if (target?.isConnected === true) {
						event.preventDefault();
						target.focus();
					}
				}}
				// Sure's drawer: 550 px, 12 px off the viewport's edges with 12 px
				// corners from 768 px; the whole screen below.
				className="data-[side=right]:w-full data-[side=right]:border-l-0 data-[side=right]:sm:max-w-none data-[side=right]:md:inset-y-3 data-[side=right]:md:right-3 data-[side=right]:md:h-auto data-[side=right]:md:w-[550px] data-[side=right]:md:rounded-xl data-[side=right]:md:border motion-reduce:transition-none motion-reduce:data-open:animate-none motion-reduce:data-closed:animate-none"
			>
				<SheetHeader className="border-b">
					<SheetTitle>
						{t(transaction === null ? "transactions.form.addTitle" : "transactions.form.editTitle")}
					</SheetTitle>
					<SheetDescription>
						{transaction?.source.kind === "import"
							? t(
									transaction.reference === null
										? "transactions.sources.import"
										: "transactions.sources.importReference",
									{
										format: transaction.source.format.toUpperCase(),
										date: formatShortDate(transaction.source.date),
										reference: transaction.reference,
									},
								)
							: transaction?.source.kind === "bank"
								? t("transactions.sources.bank", {
										connector: t(`transactions.sources.connectors.${transaction.source.connector}`),
									})
								: t("transactions.sources.manual")}
					</SheetDescription>
				</SheetHeader>
				<TransactionForm
					// A fresh form each time the sheet opens, with that transaction's
					// values; kept mounted while the sheet slides out.
					key={session}
					account={account}
					transaction={transaction}
					onClose={() => {
						dirty.current = false;
						onOpenChange(false);
					}}
					onMerged={(survivorId) => {
						survivor.current = survivorId;
						dirty.current = false;
						onOpenChange(false);
					}}
					onCancel={requestClose}
					onDirtyChange={setDirty}
				/>
				<ConfirmDialog
					open={confirmingDiscard}
					onOpenChange={setConfirmingDiscard}
					title={t("transactions.discard.title")}
					description={t("transactions.discard.description")}
					confirmLabel={t("transactions.discard.action")}
					destructive
					onConfirm={() => {
						setConfirmingDiscard(false);
						dirty.current = false;
						onOpenChange(false);
					}}
				/>
			</SheetContent>
		</Sheet>
	);
}
