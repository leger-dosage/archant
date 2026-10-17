import type { BalanceDryRun } from "@/components/BalanceConfirmation";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useRef, useState } from "react";
import { useController, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import type { SnapshotFormInput } from "@archant/api/schemas/snapshots";
import { openingBalanceSchema } from "@archant/api/schemas/snapshots";
import type { AccountType } from "@archant/data/account-types";
import type { CurrencyCode, MinorUnits } from "@archant/data/money";
import { parseAmount } from "@archant/data/money";

import { BalanceConfirmation } from "@/components/BalanceConfirmation";
import { DateField } from "@/components/DateField";
import { FieldMessage } from "@/components/FieldMessage";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";
import { useSetOpeningBalance, useSnapshotDryRun } from "@/hooks/useSnapshots";
import { amountToText } from "@/lib/amount-sign";
import { ApiError } from "@/lib/api";
import { formatTableDate } from "@/lib/balance-change";
import { toIsoDate } from "@/lib/dates";
import { showErrorToast } from "@/lib/error-toast";
import { applyFieldErrors } from "@/lib/form-errors";

const FIELD_NAMES = ["date", "balance", "notes"] as const;

/** The account whose opening balance the sheet edits, as its page reads it. */
export type OpeningAccount = {
	id: string;
	currency: CurrencyCode;
	/** Names what the confirmation step sets, as Sure's `_confirmation_contents`. */
	type: AccountType;
	openingDate: string;
	openingBalance: { balance: MinorUnits; notes: string | null };
};

type OpeningBalanceFormProps = {
	account: OpeningAccount;
	/** After a save, and on Annuler. */
	onClose: () => void;
};

function OpeningBalanceForm({ account, onClose }: OpeningBalanceFormProps) {
	const { t } = useTranslation();
	const setOpeningBalance = useSetOpeningBalance(account.id);
	const dryRun = useSnapshotDryRun(account.id);
	// Sure's `confirm_update`, posted from its drawer into the modal frame: a
	// dialog over the sheet until confirmed.
	const [pending, setPending] = useState<{
		values: SnapshotFormInput;
		result: BalanceDryRun;
	} | null>(null);
	// A save from the step in flight: cancelling then would not undo it.
	const [confirming, setConfirming] = useState(false);
	const confirmButton = useRef<HTMLButtonElement>(null);
	// Set when a save from the step is refused, so the sheet's field takes focus back.
	const refused = useRef(false);
	// The oldest entry's date the API names when the date is not before it.
	const [oldestEntryDate, setOldestEntryDate] = useState<string | null>(null);
	const schema = useMemo(() => openingBalanceSchema(account.currency), [account.currency]);
	const form = useForm<SnapshotFormInput>({
		// `raw` hands the typed text to the API as is: the same schema parses it
		// there, into minor units of the account's currency.
		resolver: zodResolver(schema, undefined, { raw: true }),
		defaultValues: {
			date: account.openingDate,
			balance: amountToText(account.openingBalance.balance, account.currency),
			notes: account.openingBalance.notes ?? "",
		},
	});
	const { errors, isSubmitting } = form.formState;
	const date = useController({ control: form.control, name: "date" });

	// The refused field, found by id: the date is a controlled field, whose
	// input react-hook-form holds no ref to.
	const focusRefusedField = () => {
		const name =
			FIELD_NAMES.find((field) => form.getFieldState(field).error !== undefined) ?? "date";

		document.getElementById(`opening-balance-${name}`)?.focus();
	};

	const showError = (error: unknown) => {
		const apiError = error instanceof ApiError ? error : new ApiError("INTERNAL_ERROR");
		setOldestEntryDate(apiError.params["date"] ?? null);
		const unplaced = applyFieldErrors(apiError.fields, FIELD_NAMES, form.setError);

		if (
			apiError.code !== "VALIDATION_ERROR" ||
			unplaced.length > 0 ||
			apiError.fields.length === 0
		) {
			showErrorToast(apiError.code);
		}
	};

	const save = async (values: SnapshotFormInput) => {
		await setOpeningBalance.mutateAsync(values);
		// No success toast: the row and the balance changing say it.
		onClose();
	};

	const submit = form.handleSubmit(async (values) => {
		try {
			// Sure's drawer saves notes apart from the reconciliation: with the
			// date and the amount as they were, nothing needs confirming.
			if (
				values.date === account.openingDate &&
				parseAmount(values.balance, account.currency) === account.openingBalance.balance
			) {
				await save(values);

				return;
			}

			const result = await dryRun.mutateAsync({ date: values.date, balance: values.balance });
			setPending({ values, result });
		} catch (error) {
			showError(error);
		}
	});

	const confirm = async () => {
		if (pending === null) {
			return;
		}

		setConfirming(true);

		try {
			await save(pending.values);
		} catch (error) {
			// Back to the sheet with the error on its field, as Sure re-renders
			// `show` with its message.
			refused.current = true;
			setPending(null);
			showError(error);
		} finally {
			setConfirming(false);
		}
	};

	return (
		<>
			<form
				id="opening-balance-form"
				noValidate
				className="flex flex-1 flex-col gap-4 overflow-y-auto px-4"
				onSubmit={(event) => void submit(event)}
			>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="opening-balance-date">{t("snapshots.opening.date")}</Label>
					<DateField
						id="opening-balance-date"
						value={date.field.value}
						onChange={date.field.onChange}
						onBlur={date.field.onBlur}
						max={toIsoDate()}
						invalid={errors.date !== undefined}
						{...(errors.date === undefined ? {} : { describedBy: "opening-balance-date-error" })}
					/>
					<FieldMessage
						id="opening-balance-date-error"
						error={errors.date}
						{...(oldestEntryDate === null ? {} : { date: formatTableDate(oldestEntryDate) })}
					/>
				</div>

				<div className="flex flex-col gap-1.5">
					<Label htmlFor="opening-balance-balance">{t("snapshots.opening.balance")}</Label>
					<Input
						id="opening-balance-balance"
						inputMode="decimal"
						autoComplete="off"
						className="text-right tabular-nums"
						aria-invalid={errors.balance !== undefined}
						{...(errors.balance === undefined
							? {}
							: { "aria-describedby": "opening-balance-balance-error" })}
						{...form.register("balance")}
					/>
					<FieldMessage id="opening-balance-balance-error" error={errors.balance} />
				</div>

				<div className="flex flex-col gap-1.5">
					<Label htmlFor="opening-balance-notes">{t("snapshots.opening.notes")}</Label>
					<Textarea
						id="opening-balance-notes"
						// A pasted reference without spaces would widen the sheet past the screen.
						className="wrap-anywhere"
						placeholder={t("snapshots.form.notesPlaceholder")}
						aria-invalid={errors.notes !== undefined}
						{...(errors.notes === undefined
							? {}
							: { "aria-describedby": "opening-balance-notes-error" })}
						{...form.register("notes")}
					/>
					<FieldMessage id="opening-balance-notes-error" error={errors.notes} />
				</div>
			</form>

			<SheetFooter className="flex-row items-center justify-end gap-2 border-t">
				<Button type="button" variant="outline" onClick={onClose}>
					{t("common.cancel")}
				</Button>
				<Button type="submit" form="opening-balance-form" disabled={isSubmitting}>
					{t("snapshots.opening.save")}
				</Button>
			</SheetFooter>

			<Dialog
				open={pending !== null}
				onOpenChange={(open) => {
					// Escape and the overlay wait for the save, as « Annuler » does.
					if (!open && !confirming) {
						setPending(null);
					}
				}}
			>
				<DialogContent
					showCloseButton={false}
					onOpenAutoFocus={(event) => {
						// The action, as the snapshot dialog's step.
						event.preventDefault();
						confirmButton.current?.focus();
					}}
					onCloseAutoFocus={(event) => {
						// After a refusal, the refused field rather than the sheet's button.
						if (refused.current) {
							refused.current = false;
							event.preventDefault();
							focusRefusedField();
						}
					}}
				>
					<DialogHeader>
						<DialogTitle>{t("snapshots.confirm.updateTitle")}</DialogTitle>
					</DialogHeader>
					{/* Mounted while the step closes, so the dialog keeps its description. */}
					<DialogDescription asChild>
						<div>
							{pending !== null && (
								<BalanceConfirmation
									type={account.type}
									currency={account.currency}
									result={pending.result}
									update
								/>
							)}
						</div>
					</DialogDescription>
					<DialogFooter className="flex-row justify-end gap-2">
						<Button
							type="button"
							variant="outline"
							disabled={confirming}
							onClick={() => setPending(null)}
						>
							{t("common.cancel")}
						</Button>
						<Button
							ref={confirmButton}
							type="button"
							disabled={confirming}
							onClick={() => void confirm()}
						>
							{t("snapshots.confirm.updateAction")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

type OpeningBalanceSheetProps = {
	account: OpeningAccount;
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

/**
 * Sure's valuation drawer on an opening balance: its date and the account's
 * value that day, saved after Sure's confirmation step when either changes.
 * Focus goes back to the « Solde d'ouverture » row, even after a refetch
 * remounted it.
 */
export function OpeningBalanceSheet({ account, open, onOpenChange }: OpeningBalanceSheetProps) {
	const { t } = useTranslation();
	const [session, setSession] = useState(0);
	const [wasOpen, setWasOpen] = useState(open);

	if (open !== wasOpen) {
		setWasOpen(open);
		if (open) {
			setSession((current) => current + 1);
		}
	}

	// Radix returns focus to a `SheetTrigger`; this sheet is opened from a row
	// of the page instead, so it remembers which one itself.
	const opener = useRef<HTMLElement | null>(null);

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent
				onOpenAutoFocus={() => {
					opener.current =
						document.activeElement instanceof HTMLElement ? document.activeElement : null;
				}}
				onCloseAutoFocus={(event) => {
					const target =
						opener.current?.isConnected === true
							? opener.current
							: document.querySelector<HTMLElement>("[data-opening-balance]");

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
					<SheetTitle>{t("snapshots.opening.title")}</SheetTitle>
					<SheetDescription>{t("snapshots.opening.description")}</SheetDescription>
				</SheetHeader>
				<OpeningBalanceForm
					// A fresh form each time the sheet opens, with the current values.
					key={session}
					account={account}
					onClose={() => onOpenChange(false)}
				/>
			</SheetContent>
		</Sheet>
	);
}
