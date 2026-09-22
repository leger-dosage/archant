import type { SnapshotData } from "@/hooks/useSnapshots";
import type { FieldError } from "react-hook-form";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useRef, useState } from "react";
import { useController, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import type { SnapshotFormInput } from "@archant/api/schemas/snapshots";
import { createSnapshotSchema } from "@archant/api/schemas/snapshots";
import type { CurrencyCode } from "@archant/data/money";
import { formatMoney } from "@archant/data/money";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DateField } from "@/components/DateField";
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
import { useCreateSnapshot, useDeleteSnapshot, useUpdateSnapshot } from "@/hooks/useSnapshots";
import { amountToText } from "@/lib/amount-sign";
import { ApiError } from "@/lib/api";
import { formatTableDate } from "@/lib/balance-change";
import { toIsoDate } from "@/lib/dates";
import { showErrorToast } from "@/lib/error-toast";
import { applyFieldErrors, fieldErrorCode } from "@/lib/form-errors";

const FIELD_NAMES = ["date", "balance"] as const;

export type SnapshotAccount = { id: string; currency: CurrencyCode };

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

function valuesOf(snapshot: SnapshotData | null): SnapshotFormInput {
	return snapshot === null
		? { date: toIsoDate(), balance: "" }
		: { date: snapshot.date, balance: amountToText(snapshot.balance, snapshot.currency) };
}

type SnapshotFormProps = {
	account: SnapshotAccount;
	snapshot: SnapshotData | null;
	/** After a save or a delete, and on Annuler. */
	onClose: () => void;
};

function SnapshotForm({ account, snapshot, onClose }: SnapshotFormProps) {
	const { t } = useTranslation();
	const createSnapshot = useCreateSnapshot(account.id);
	const updateSnapshot = useUpdateSnapshot(account.id);
	const deleteSnapshot = useDeleteSnapshot(account.id);
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const schema = useMemo(() => createSnapshotSchema(account.currency), [account.currency]);
	const form = useForm<SnapshotFormInput>({
		// `raw` hands the typed text to the API as is: the same schema parses it
		// there, into minor units of the account's currency.
		resolver: zodResolver(schema, undefined, { raw: true }),
		defaultValues: valuesOf(snapshot),
	});
	const { errors, isSubmitting } = form.formState;
	const date = useController({ control: form.control, name: "date" });

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

	const submit = form.handleSubmit(async (values) => {
		try {
			if (snapshot === null) {
				await createSnapshot.mutateAsync(values);
			} else {
				await updateSnapshot.mutateAsync({ id: snapshot.id, input: values });
			}
			// No success toast: the row and the balance changing say it.
			onClose();
		} catch (error) {
			showError(error);
		}
	});

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

	return (
		<>
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
 * Records or edits the balance the bank shows at the end of a day. Focus goes
 * back to what opened it, even when the edit moved its row.
 */
export function SnapshotDialog({ account, open, snapshot, onOpenChange }: SnapshotDialogProps) {
	const { t } = useTranslation();
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
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				showCloseButton={false}
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
				<DialogHeader>
					<DialogTitle>
						{t(snapshot === null ? "snapshots.form.addTitle" : "snapshots.form.editTitle")}
					</DialogTitle>
					<DialogDescription>{t("snapshots.form.description")}</DialogDescription>
				</DialogHeader>
				<SnapshotForm
					// A fresh form each time the dialog opens, with that snapshot's values.
					key={session}
					account={account}
					snapshot={snapshot}
					onClose={() => onOpenChange(false)}
				/>
			</DialogContent>
		</Dialog>
	);
}
