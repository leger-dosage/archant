import type { TransactionData } from "@/hooks/useTransactions";
import type { FieldError } from "react-hook-form";

import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useController, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { TransactionFormInput } from "@archant/api/schemas/transactions";
import { transactionFormSchema } from "@archant/api/schemas/transactions";
import type { CurrencyCode } from "@archant/data/money";
import { formatMoney } from "@archant/data/money";

import { AmountField } from "@/components/AmountField";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DateField } from "@/components/DateField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import {
	useCreateTransaction,
	useDeleteTransaction,
	useUpdateTransaction,
} from "@/hooks/useTransactions";
import { amountToText } from "@/lib/amount-sign";
import { ApiError } from "@/lib/api";
import { formatShortDate } from "@/lib/balance-change";
import { toIsoDate } from "@/lib/dates";
import { applyFieldErrors, fieldErrorCode } from "@/lib/form-errors";

const FIELD_NAMES = ["date", "label", "amount", "notes"] as const;

type FieldName = (typeof FIELD_NAMES)[number];

export type SheetAccount = { id: string; currency: CurrencyCode; openingDate: string };

/**
 * A new transaction's default date: today, unless the account opened today or
 * later, where the first day it accepts is the day after its opening date.
 */
function defaultDate(openingDate: string): string {
	const dayAfterOpening = new Date(Date.parse(`${openingDate}T00:00:00Z`) + 86_400_000)
		.toISOString()
		.slice(0, 10);
	const today = toIsoDate();

	return today > dayAfterOpening ? today : dayAfterOpening;
}

function FieldMessage({ id, error }: { id: string; error: FieldError | undefined }) {
	const { t } = useTranslation();

	if (error === undefined) {
		return null;
	}

	return (
		<p id={id} className="text-xs text-destructive">
			{t(`errors.fields.${fieldErrorCode(error)}`)}
		</p>
	);
}

function valuesOf(transaction: TransactionData | null, openingDate: string): TransactionFormInput {
	return transaction === null
		? { date: defaultDate(openingDate), label: "", amount: "", notes: "", excluded: false }
		: {
				date: transaction.date,
				label: transaction.label,
				amount: amountToText(transaction.amount, transaction.currency),
				notes: transaction.notes ?? "",
				excluded: transaction.excluded,
			};
}

type TransactionFormProps = {
	account: SheetAccount;
	transaction: TransactionData | null;
	/** After a save or a delete. */
	onClose: () => void;
	/** Annuler: the sheet decides whether to ask first. */
	onCancel: () => void;
	onDirtyChange: (dirty: boolean) => void;
};

function TransactionForm({
	account,
	transaction,
	onClose,
	onCancel,
	onDirtyChange,
}: TransactionFormProps) {
	const { t } = useTranslation();
	const createTransaction = useCreateTransaction(account.id);
	const updateTransaction = useUpdateTransaction(account.id);
	const deleteTransaction = useDeleteTransaction(account.id);
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const schema = useMemo(() => transactionFormSchema(account.currency), [account.currency]);
	const form = useForm<TransactionFormInput>({
		// `raw` hands the typed text to the API as is: the same schema parses it
		// there, into minor units of the account's currency.
		resolver: zodResolver(schema, undefined, { raw: true }),
		defaultValues: valuesOf(transaction, account.openingDate),
	});
	const { errors, isSubmitting, isDirty } = form.formState;
	const date = useController({ control: form.control, name: "date" });
	const amount = useController({ control: form.control, name: "amount" });
	const excluded = useController({ control: form.control, name: "excluded" });

	useEffect(() => {
		onDirtyChange(isDirty);
	}, [isDirty, onDirtyChange]);

	const showError = (error: unknown) => {
		const apiError = error instanceof ApiError ? error : new ApiError("INTERNAL_ERROR");
		const unplaced = applyFieldErrors(apiError.fields, FIELD_NAMES, form.setError);

		if (
			apiError.code !== "VALIDATION_ERROR" ||
			unplaced.length > 0 ||
			apiError.fields.length === 0
		) {
			toast.error(t(`errors.${apiError.code}`));
		}
	};

	const submit = form.handleSubmit(async (values) => {
		try {
			if (transaction === null) {
				// A new transaction is always counted; the switch shows on edits only.
				const { excluded: _excluded, ...input } = values;
				await createTransaction.mutateAsync(input);
			} else {
				await updateTransaction.mutateAsync({ id: transaction.id, input: values });
			}
			// No success toast: the row and the balance changing say it.
			onClose();
		} catch (error) {
			showError(error);
		}
	});

	const remove = async () => {
		if (transaction === null) {
			return;
		}

		try {
			await deleteTransaction.mutateAsync(transaction.id);
			setConfirmingDelete(false);
			onClose();
		} catch (error) {
			setConfirmingDelete(false);
			showError(error);
		}
	};

	const describedBy = (name: FieldName) =>
		errors[name] === undefined ? {} : { "aria-describedby": `transaction-${name}-error` };

	return (
		<>
			<form
				id="transaction-form"
				noValidate
				className="flex flex-1 flex-col gap-4 overflow-y-auto px-4"
				onSubmit={(event) => void submit(event)}
				onKeyDown={(event) => {
					if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
						event.preventDefault();
						// The button is disabled while saving; the shortcut must be too,
						// or a double press records the transaction twice.
						if (!form.formState.isSubmitting) {
							void submit();
						}
					}
				}}
			>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="transaction-date">{t("transactions.form.date")}</Label>
					<DateField
						id="transaction-date"
						value={date.field.value}
						onChange={date.field.onChange}
						onBlur={date.field.onBlur}
						invalid={errors.date !== undefined}
						{...(errors.date === undefined ? {} : { describedBy: "transaction-date-error" })}
					/>
					<FieldMessage id="transaction-date-error" error={errors.date} />
				</div>

				<div className="flex flex-col gap-1.5">
					<Label htmlFor="transaction-label">{t("transactions.form.label")}</Label>
					<Input
						id="transaction-label"
						autoComplete="off"
						aria-invalid={errors.label !== undefined}
						{...describedBy("label")}
						{...form.register("label")}
					/>
					<FieldMessage id="transaction-label-error" error={errors.label} />
				</div>

				<div className="flex flex-col gap-1.5">
					<Label htmlFor="transaction-amount">{t("transactions.form.amount")}</Label>
					<AmountField
						id="transaction-amount"
						value={amount.field.value}
						onChange={amount.field.onChange}
						onBlur={amount.field.onBlur}
						invalid={errors.amount !== undefined}
						{...(errors.amount === undefined ? {} : { describedBy: "transaction-amount-error" })}
					/>
					<FieldMessage id="transaction-amount-error" error={errors.amount} />
				</div>

				<div className="flex flex-col gap-1.5">
					<Label htmlFor="transaction-notes">{t("transactions.form.notes")}</Label>
					<textarea
						id="transaction-notes"
						rows={4}
						className="min-h-20 w-full rounded-sm border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30"
						aria-invalid={errors.notes !== undefined}
						{...describedBy("notes")}
						{...form.register("notes")}
					/>
					<FieldMessage id="transaction-notes-error" error={errors.notes} />
				</div>

				{transaction !== null && (
					<div className="flex items-center justify-between gap-4">
						<Label htmlFor="transaction-excluded">{t("transactions.form.excluded")}</Label>
						<Switch
							id="transaction-excluded"
							checked={excluded.field.value}
							onCheckedChange={excluded.field.onChange}
							onBlur={excluded.field.onBlur}
						/>
					</div>
				)}
			</form>

			<SheetFooter className="flex-row items-center justify-between border-t">
				{transaction === null ? (
					<span />
				) : (
					<Button type="button" variant="destructive" onClick={() => setConfirmingDelete(true)}>
						{t("transactions.delete.action")}
					</Button>
				)}
				<div className="flex gap-2">
					<Button type="button" variant="outline" onClick={onCancel}>
						{t("common.cancel")}
					</Button>
					<Button
						type="submit"
						form="transaction-form"
						disabled={isSubmitting}
						title={t("transactions.form.saveShortcut")}
					>
						{t("transactions.form.save")}
					</Button>
				</div>
			</SheetFooter>

			{transaction !== null && (
				<ConfirmDialog
					open={confirmingDelete}
					onOpenChange={setConfirmingDelete}
					title={t("transactions.delete.title", { label: transaction.label })}
					description={t("transactions.delete.description", {
						amount: formatMoney({ amount: transaction.amount, currency: transaction.currency }),
					})}
					confirmLabel={t("transactions.delete.action")}
					destructive
					pending={deleteTransaction.isPending}
					onConfirm={() => void remove()}
				/>
			)}
		</>
	);
}

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
						opener.current?.isConnected === true || id === undefined
							? opener.current
							: document.querySelector<HTMLElement>(`[data-transaction-id="${CSS.escape(id)}"]`);

					if (target?.isConnected === true) {
						event.preventDefault();
						target.focus();
					}
				}}
				className="w-full data-[side=right]:w-full data-[side=right]:sm:max-w-md motion-reduce:transition-none motion-reduce:data-open:animate-none motion-reduce:data-closed:animate-none"
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
