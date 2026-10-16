import type { BalanceDryRun } from "@/components/BalanceConfirmation";
import type { SnapshotData } from "@/hooks/useSnapshots";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useRef, useState } from "react";
import { useController, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import type { SnapshotFormInput } from "@archant/api/schemas/snapshots";
import { createSnapshotSchema } from "@archant/api/schemas/snapshots";
import type { AccountType } from "@archant/data/account-types";
import type { CurrencyCode } from "@archant/data/money";
import { formatMoney, parseAmount } from "@archant/data/money";

import { BalanceConfirmation } from "@/components/BalanceConfirmation";
import { ConfirmDialog } from "@/components/ConfirmDialog";
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
import { Textarea } from "@/components/ui/textarea";
import {
	useCreateSnapshot,
	useDeleteSnapshot,
	useSnapshotDryRun,
	useUpdateSnapshot,
} from "@/hooks/useSnapshots";
import { amountToText } from "@/lib/amount-sign";
import { ApiError } from "@/lib/api";
import { formatTableDate } from "@/lib/balance-change";
import { toIsoDate } from "@/lib/dates";
import { showErrorToast } from "@/lib/error-toast";
import { applyFieldErrors } from "@/lib/form-errors";

const FIELD_NAMES = ["date", "balance", "notes"] as const;

type SnapshotAccount = { id: string; currency: CurrencyCode; type: AccountType };

function valuesOf(snapshot: SnapshotData | null): SnapshotFormInput {
	return snapshot === null
		? { date: toIsoDate(), balance: "" }
		: {
				date: snapshot.date,
				balance: amountToText(snapshot.balance, snapshot.currency),
				notes: snapshot.notes ?? "",
			};
}

type SnapshotFormProps = {
	account: SnapshotAccount;
	snapshot: SnapshotData | null;
	/** After a save or a delete, and on Annuler. */
	onClose: () => void;
	/** While the step's save runs, the dialog refuses to close. */
	onSavingChange: (saving: boolean) => void;
};

function SnapshotForm({ account, snapshot, onClose, onSavingChange }: SnapshotFormProps) {
	const { t } = useTranslation();
	const createSnapshot = useCreateSnapshot(account.id);
	const updateSnapshot = useUpdateSnapshot(account.id);
	const deleteSnapshot = useDeleteSnapshot(account.id);
	const dryRun = useSnapshotDryRun(account.id);
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	// A save from the step in flight: cancelling then would not undo it.
	const [saving, setSaving] = useState(false);
	// Sure's `confirm_create` or `confirm_update`: the typed values and what
	// they would set, shown in place of the form until confirmed.
	const [pending, setPending] = useState<{
		values: SnapshotFormInput;
		result: BalanceDryRun;
	} | null>(null);
	const confirmButton = useRef<HTMLButtonElement>(null);
	// Set when the step gives way to the form again, refused or cancelled, so a field takes focus back.
	const backToForm = useRef(false);
	const schema = useMemo(() => createSnapshotSchema(account.currency), [account.currency]);
	const form = useForm<SnapshotFormInput>({
		// `raw` hands the typed text to the API as is: the same schema parses it
		// there, into minor units of the account's currency.
		resolver: zodResolver(schema, undefined, { raw: true }),
		defaultValues: valuesOf(snapshot),
	});
	const { errors, isSubmitting } = form.formState;
	const date = useController({ control: form.control, name: "date" });

	useEffect(() => {
		if (pending !== null) {
			confirmButton.current?.focus();
		} else if (backToForm.current) {
			backToForm.current = false;
			// Found by id: the date is a controlled field, whose input
			// react-hook-form holds no ref to.
			const name =
				FIELD_NAMES.find((field) => form.getFieldState(field).error !== undefined) ?? "date";
			document.getElementById(`snapshot-${name}`)?.focus();
		}
	}, [pending, form]);

	const showError = (error: unknown) => {
		const apiError = error instanceof ApiError ? error : new ApiError("INTERNAL_ERROR");
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
		if (snapshot === null) {
			await createSnapshot.mutateAsync(values);
		} else {
			await updateSnapshot.mutateAsync({ id: snapshot.id, input: values });
		}
		// No success toast: the row and the balance changing say it.
		onClose();
	};

	const submit = form.handleSubmit(async (values) => {
		try {
			// Sure's drawer saves notes apart from the reconciliation: with the
			// date and the amount as they were, nothing needs confirming.
			if (
				snapshot !== null &&
				values.date === snapshot.date &&
				parseAmount(values.balance, account.currency) === snapshot.balance
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

		setSaving(true);
		onSavingChange(true);

		try {
			await save(pending.values);
		} catch (error) {
			// Back to the form with the error on its field, as Sure re-renders
			// `new` or `show` with its message.
			backToForm.current = true;
			setPending(null);
			showError(error);
		} finally {
			setSaving(false);
			onSavingChange(false);
		}
	};

	const remove = async () => {
		if (snapshot === null) {
			return;
		}

		try {
			await deleteSnapshot.mutateAsync(snapshot.id);
			setConfirmingDelete(false);
			onClose();
		} catch (error) {
			setConfirmingDelete(false);
			showError(error);
		}
	};

	if (pending !== null) {
		const update = snapshot !== null;

		return (
			<>
				<DialogHeader>
					<DialogTitle>
						{t(update ? "snapshots.confirm.updateTitle" : "snapshots.confirm.createTitle")}
					</DialogTitle>
				</DialogHeader>
				<DialogDescription asChild>
					<div>
						<BalanceConfirmation
							type={account.type}
							currency={account.currency}
							result={pending.result}
							update={update}
						/>
					</div>
				</DialogDescription>
				<DialogFooter className="flex-row justify-end gap-2">
					<Button
						type="button"
						variant="outline"
						disabled={saving}
						// Back to the form with what was typed, as Sure's modal closes over its drawer.
						onClick={() => {
							backToForm.current = true;
							setPending(null);
						}}
					>
						{t("common.cancel")}
					</Button>
					<Button
						ref={confirmButton}
						type="button"
						disabled={saving}
						onClick={() => void confirm()}
					>
						{t(update ? "snapshots.confirm.updateAction" : "snapshots.confirm.confirm")}
					</Button>
				</DialogFooter>
			</>
		);
	}

	return (
		<>
			<DialogHeader>
				<DialogTitle>
					{t(snapshot === null ? "snapshots.form.addTitle" : "snapshots.form.editTitle")}
				</DialogTitle>
				<DialogDescription>{t("snapshots.form.description")}</DialogDescription>
			</DialogHeader>
			<form
				id="snapshot-form"
				noValidate
				className="flex flex-col gap-4"
				onSubmit={(event) => void submit(event)}
			>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="snapshot-date">{t("snapshots.form.date")}</Label>
					<DateField
						id="snapshot-date"
						value={date.field.value}
						onChange={date.field.onChange}
						onBlur={date.field.onBlur}
						invalid={errors.date !== undefined}
						{...(errors.date === undefined ? {} : { describedBy: "snapshot-date-error" })}
					/>
					<FieldMessage id="snapshot-date-error" error={errors.date} />
				</div>

				<div className="flex flex-col gap-1.5">
					<Label htmlFor="snapshot-balance">{t("snapshots.form.balance")}</Label>
					<Input
						id="snapshot-balance"
						inputMode="decimal"
						autoComplete="off"
						className="text-right tabular-nums"
						aria-invalid={errors.balance !== undefined}
						{...(errors.balance === undefined
							? {}
							: { "aria-describedby": "snapshot-balance-error" })}
						{...form.register("balance")}
					/>
					<FieldMessage id="snapshot-balance-error" error={errors.balance} />
				</div>

				{snapshot !== null && (
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="snapshot-notes">{t("snapshots.form.notes")}</Label>
						<Textarea
							id="snapshot-notes"
							// A pasted reference without spaces would widen the dialog past the screen.
							className="wrap-anywhere"
							placeholder={t("snapshots.form.notesPlaceholder")}
							aria-invalid={errors.notes !== undefined}
							{...(errors.notes === undefined
								? {}
								: { "aria-describedby": "snapshot-notes-error" })}
							{...form.register("notes")}
						/>
						<FieldMessage id="snapshot-notes-error" error={errors.notes} />
					</div>
				)}
			</form>

			<DialogFooter className="flex-row items-center justify-between sm:justify-between">
				{snapshot === null ? (
					<span />
				) : (
					<Button type="button" variant="destructive" onClick={() => setConfirmingDelete(true)}>
						{t("snapshots.delete.action")}
					</Button>
				)}
				<div className="flex gap-2">
					<Button type="button" variant="outline" onClick={onClose}>
						{t("common.cancel")}
					</Button>
					<Button type="submit" form="snapshot-form" disabled={isSubmitting}>
						{t("snapshots.form.save")}
					</Button>
				</div>
			</DialogFooter>

			{snapshot !== null && (
				<ConfirmDialog
					open={confirmingDelete}
					onOpenChange={setConfirmingDelete}
					title={t("snapshots.delete.title", { date: formatTableDate(snapshot.date) })}
					description={t("snapshots.delete.description", {
						amount: formatMoney({ amount: snapshot.balance, currency: snapshot.currency }),
					})}
					confirmLabel={t("snapshots.delete.action")}
					destructive
					pending={deleteSnapshot.isPending}
					onConfirm={() => void remove()}
				/>
			)}
		</>
	);
}

type SnapshotDialogProps = {
	account: SnapshotAccount;
	open: boolean;
	/** `null` to record a new snapshot. */
	snapshot: SnapshotData | null;
	onOpenChange: (open: boolean) => void;
};

/**
 * Records or edits the balance the bank shows at the end of a day, after
 * Sure's confirmation step, which takes the dialog's place as Sure's
 * `confirm_create` replaces its `new` modal. Focus goes back to what opened
 * it, even when the edit moved its row.
 */
export function SnapshotDialog({ account, open, snapshot, onOpenChange }: SnapshotDialogProps) {
	const [saving, setSaving] = useState(false);
	const [session, setSession] = useState(0);
	const [wasOpen, setWasOpen] = useState(open);

	if (open !== wasOpen) {
		setWasOpen(open);
		if (open) {
			setSession((current) => current + 1);
		}
	}

	// Radix returns focus to a `DialogTrigger`; this dialog is opened from rows
	// and buttons of the page instead, so it remembers which one itself.
	const opener = useRef<HTMLElement | null>(null);

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				// Escape and the overlay wait for the step's save, as « Annuler » does.
				if (next || !saving) {
					onOpenChange(next);
				}
			}}
		>
			<DialogContent
				showCloseButton={false}
				// Long notes grow the field; the dialog scrolls rather than push
				// « Enregistrer » off the screen.
				className="max-h-[90vh] overflow-y-auto"
				onOpenAutoFocus={() => {
					opener.current =
						document.activeElement instanceof HTMLElement ? document.activeElement : null;
				}}
				onCloseAutoFocus={(event) => {
					const id = opener.current?.dataset["snapshotId"];
					const target =
						opener.current?.isConnected === true || id === undefined
							? opener.current
							: document.querySelector<HTMLElement>(`[data-snapshot-id="${CSS.escape(id)}"]`);

					if (target?.isConnected === true) {
						event.preventDefault();
						target.focus();
					}
				}}
			>
				<SnapshotForm
					// A fresh form each time the dialog opens, with that snapshot's values.
					key={session}
					account={account}
					snapshot={snapshot}
					onClose={() => onOpenChange(false)}
					onSavingChange={setSaving}
				/>
			</DialogContent>
		</Dialog>
	);
}
