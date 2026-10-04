import type { TransferLink } from "@/components/TransactionLinks";
import type { TransactionData } from "@/hooks/useTransactions";
import type { FieldError } from "react-hook-form";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useRef, useState } from "react";
import { useController, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import type { TransactionFormInput } from "@archant/api/schemas/transactions";
import { transactionFormSchema } from "@archant/api/schemas/transactions";
import type { CurrencyCode } from "@archant/data/money";
import { formatMoney } from "@archant/data/money";

import { AmountField } from "@/components/AmountField";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DateField } from "@/components/DateField";
import { FieldMessage } from "@/components/FieldMessage";
import { TransactionAttachments } from "@/components/TransactionAttachments";
import { CategoryField, MerchantField, TagsField } from "@/components/TransactionFields";
import { DuplicateBlock, RecurringBlock, TransferBlock } from "@/components/TransactionLinks";
import { SplitBlock } from "@/components/TransactionSplit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SheetFooter } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useAttachmentCount } from "@/hooks/useAttachments";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import {
	useCreateTransaction,
	useDeleteTransaction,
	useSplit,
	useUpdateTransaction,
} from "@/hooks/useTransactions";
import { ApiError } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";
import { applyFieldErrors } from "@/lib/form-errors";
import { valuesOf } from "@/lib/transaction-form";
import { showsCategory } from "@/lib/transfers";

const FIELD_NAMES = [
	"date",
	"label",
	"amount",
	"notes",
	"categoryId",
	"merchantId",
	"tagIds",
] as const;

type FieldName = (typeof FIELD_NAMES)[number];

export type SheetAccount = { id: string; currency: CurrencyCode; openingDate: string };

function sameTags(a: readonly string[], b: readonly string[]): boolean {
	const set = new Set(a);

	return set.size === b.length && b.every((id) => set.has(id));
}

type TransactionFormProps = {
	account: SheetAccount;
	transaction: TransactionData | null;
	/** After a save or a delete. */
	onClose: () => void;
	/**
	 * After a merge, a split, its edit or its undoing: the sheet closes and
	 * focus goes to that row, the survivor's or the split parent's.
	 */
	onCloseFocusing: (rowId: string) => void;
	/** Annuler: the sheet decides whether to ask first. */
	onCancel: () => void;
	onDirtyChange: (dirty: boolean) => void;
};

export function TransactionForm({
	account,
	transaction,
	onClose,
	onCloseFocusing,
	onCancel,
	onDirtyChange,
}: TransactionFormProps) {
	const { t } = useTranslation();
	// A viewer reads every field, disabled, and saves nothing.
	const admin = useIsAdmin();
	const createTransaction = useCreateTransaction(account.id);
	const updateTransaction = useUpdateTransaction(account.id);
	const deleteTransaction = useDeleteTransaction(account.id);
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const [transfer, setTransfer] = useState<TransferLink>(transaction?.transfer ?? null);
	// Hidden once resolved here; a refetch clearing the flag hides it too.
	const [duplicateHidden, setDuplicateHidden] = useState(false);
	const duplicate = transaction?.possibleDuplicate === true && !duplicateHidden;
	// A split's parent and its lines keep their date, amount and exclusion,
	// which only the split changes (AD-20); a line keeps its parent's merchant
	// and goes only with its parent.
	const splitParent = transaction?.splitParent === true;
	const splitChild = transaction !== null && transaction.parentEntryId !== null;
	const inSplit = splitParent || splitChild;
	// The ledger's own refusal, read from what the sheet shows: a transfer
	// matched here meanwhile counts.
	const splittable =
		transaction !== null &&
		!inSplit &&
		transfer === null &&
		!transaction.pending &&
		!transaction.excluded &&
		!duplicate;
	// What the delete takes with it: its own attachments and, for a split's
	// parent, its lines'. The lines' lists are read only once it is asked for.
	const split = useSplit(transaction?.id ?? "", splitParent);
	const goingIds =
		transaction === null
			? []
			: [transaction.id, ...(split.data?.children.map((line) => line.id) ?? [])];
	const { count: goingAttachmentCount, loading: countingAttachments } = useAttachmentCount(
		goingIds,
		confirmingDelete,
	);
	// Confirmed only once the count is known, so the dialog never omits a
	// receipt that goes; a failed read releases it.
	const attachmentCountUnknown = countingAttachments || (splitParent && split.isPending);
	const formRef = useRef<HTMLFormElement>(null);
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
	const category = useController({ control: form.control, name: "categoryId" });
	const merchant = useController({ control: form.control, name: "merchantId" });
	const tagIds = useController({ control: form.control, name: "tagIds" });

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
			showErrorToast(apiError.code);
		}
	};

	const submit = form.handleSubmit(async (values) => {
		try {
			if (transaction === null) {
				// A new transaction is always counted, starts « Sans catégorie » and
				// « Sans marchand », and carries no tag: the switch, the category, the
				// merchant and the tags show on edits only.
				const {
					excluded: _excluded,
					categoryId: _categoryId,
					merchantId: _merchantId,
					tagIds: _tagIds,
					...input
				} = values;
				await createTransaction.mutateAsync(input);
			} else {
				// Sent only when changed: a category, a merchant or a tag deleted
				// elsewhere since the sheet opened would otherwise refuse the save of
				// any other field. Tags are a set, so their order is no change.
				const { categoryId, merchantId, tagIds: tags, ...rest } = values;
				const { dirtyFields } = form.formState;
				const input = {
					...rest,
					// Hidden once a transfer the dashboard does not count is matched in
					// this sheet: not the user's to save.
					...(dirtyFields.categoryId === true && showsCategory(transaction.amount, transfer)
						? { categoryId }
						: {}),
					...(dirtyFields.merchantId === true ? { merchantId } : {}),
					...(sameTags(tags, transaction.tagIds) ? {} : { tagIds: tags }),
				};
				await updateTransaction.mutateAsync({ id: transaction.id, input });
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

	// An array field's error may carry one per item; the API reports the set as a whole.
	const tagsError: FieldError | undefined =
		errors.tagIds?.type === undefined
			? undefined
			: {
					type: errors.tagIds.type,
					...(errors.tagIds.message === undefined ? {} : { message: errors.tagIds.message }),
				};

	const describedBy = (name: FieldName) =>
		errors[name] === undefined ? {} : { "aria-describedby": `transaction-${name}-error` };

	return (
		<>
			<form
				ref={formRef}
				id="transaction-form"
				noValidate
				className="flex flex-1 flex-col gap-4 overflow-y-auto px-4"
				onSubmit={(event) => {
					// A dialog opened from a block below is portaled out of this form,
					// but React bubbles its submit here along the component tree: the
					// split dialog's « Diviser » once also saved this sheet.
					if (event.target !== event.currentTarget) {
						return;
					}

					if (!admin) {
						event.preventDefault();
						return;
					}

					void submit(event);
				}}
				onKeyDown={(event) => {
					// Same bubbling: ⌘Enter in a dialog of a block is that dialog's.
					if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) {
						return;
					}

					if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && admin) {
						event.preventDefault();
						// The button is disabled while saving; the shortcut must be too,
						// or a double press records the transaction twice.
						if (!form.formState.isSubmitting) {
							void submit();
						}
					}
				}}
			>
				{transaction !== null && (
					<SplitBlock
						transaction={transaction}
						currency={account.currency}
						splittable={splittable}
						dirty={isDirty}
						onDone={onCloseFocusing}
					/>
				)}
				{transaction !== null && duplicate && (
					<DuplicateBlock
						transaction={transaction}
						onDismissed={() => {
							setDuplicateHidden(true);
							// The block goes with the button that had focus: the next control takes it.
							requestAnimationFrame(() =>
								formRef.current?.querySelector<HTMLElement>("button, input, textarea")?.focus(),
							);
						}}
						onMerged={onCloseFocusing}
						onResolved={() => setDuplicateHidden(true)}
						onGone={onClose}
					/>
				)}
				{transaction !== null && !inSplit && (
					<TransferBlock transaction={transaction} transfer={transfer} onChange={setTransfer} />
				)}
				{transaction !== null && !splitParent && showsCategory(transaction.amount, transfer) && (
					<RecurringBlock transaction={transaction} dirty={isDirty} />
				)}

				<fieldset disabled={!admin} className="flex min-w-0 flex-col gap-4">
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="transaction-date">{t("transactions.form.date")}</Label>
						<DateField
							id="transaction-date"
							value={date.field.value}
							onChange={date.field.onChange}
							onBlur={date.field.onBlur}
							disabled={inSplit}
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
							disabled={inSplit}
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

					{/* A transfer side the dashboard does not count has no category to pick. */}
					{transaction !== null && showsCategory(transaction.amount, transfer) && (
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="transaction-category">{t("transactions.form.category")}</Label>
							<CategoryField
								value={category.field.value}
								onChange={category.field.onChange}
								invalid={errors.categoryId !== undefined}
								describedBy={
									errors.categoryId === undefined ? undefined : "transaction-categoryId-error"
								}
							/>
							<FieldMessage id="transaction-categoryId-error" error={errors.categoryId} />
						</div>
					)}

					{transaction !== null && (
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="transaction-merchant">{t("transactions.form.merchant")}</Label>
							<MerchantField
								disabled={splitChild}
								value={merchant.field.value}
								onChange={merchant.field.onChange}
								invalid={errors.merchantId !== undefined}
								describedBy={
									errors.merchantId === undefined ? undefined : "transaction-merchantId-error"
								}
							/>
							<FieldMessage id="transaction-merchantId-error" error={errors.merchantId} />
						</div>
					)}

					{transaction !== null && (
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="transaction-tags">{t("transactions.form.tags")}</Label>
							<TagsField
								value={tagIds.field.value}
								onChange={tagIds.field.onChange}
								invalid={errors.tagIds !== undefined}
								describedBy={errors.tagIds === undefined ? undefined : "transaction-tagIds-error"}
							/>
							<FieldMessage id="transaction-tagIds-error" error={tagsError} />
						</div>
					)}

					{transaction !== null && !inSplit && (
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
				</fieldset>

				{transaction !== null && <TransactionAttachments transaction={transaction} />}
			</form>

			<SheetFooter className="flex-row items-center justify-between border-t">
				{transaction === null || splitChild || !admin ? (
					<span />
				) : (
					<Button type="button" variant="destructive" onClick={() => setConfirmingDelete(true)}>
						{t("transactions.delete.action")}
					</Button>
				)}
				<div className="flex gap-2">
					<Button type="button" variant="outline" onClick={onCancel}>
						{admin ? t("common.cancel") : t("common.close")}
					</Button>
					{admin && (
						<Button
							type="submit"
							form="transaction-form"
							disabled={isSubmitting}
							title={t("transactions.form.saveShortcut")}
							aria-keyshortcuts="Meta+Enter Control+Enter"
						>
							{t("transactions.form.save")}
						</Button>
					)}
				</div>
			</SheetFooter>

			{transaction !== null && (
				<ConfirmDialog
					open={confirmingDelete}
					onOpenChange={setConfirmingDelete}
					title={t("transactions.delete.title", { label: transaction.label })}
					description={[
						t(
							splitParent
								? "transactions.delete.splitDescription"
								: "transactions.delete.description",
							{
								amount: formatMoney({ amount: transaction.amount, currency: transaction.currency }),
							},
						),
						...(goingAttachmentCount === 0
							? []
							: [t("transactions.delete.attachments", { count: goingAttachmentCount })]),
					].join(" ")}
					confirmLabel={t("transactions.delete.action")}
					destructive
					pending={deleteTransaction.isPending || attachmentCountUnknown}
					onConfirm={() => void remove()}
				/>
			)}
		</>
	);
}
