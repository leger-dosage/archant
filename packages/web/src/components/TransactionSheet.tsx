import type { TransactionData } from "@/hooks/useTransactions";
import type { TransferCandidateData } from "@/hooks/useTransfers";
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
import { CategoryCombobox } from "@/components/CategoryCombobox";
import { CategoryDot } from "@/components/CategoryDot";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DateField } from "@/components/DateField";
import { DuplicateDialog } from "@/components/DuplicateDialog";
import { DuplicateFlag } from "@/components/DuplicateFlag";
import { MerchantCombobox } from "@/components/MerchantCombobox";
import { TagCombobox } from "@/components/TagCombobox";
import { TransferDialog } from "@/components/TransferDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useCategories, useCategoryShown } from "@/hooks/useCategories";
import { useDismissDuplicate, useMergeDuplicate } from "@/hooks/useDuplicates";
import { useMerchants } from "@/hooks/useMerchants";
import { useAddRecurring } from "@/hooks/useRecurring";
import { useTags } from "@/hooks/useTags";
import {
	useCreateTransaction,
	useDeleteTransaction,
	useUpdateTransaction,
} from "@/hooks/useTransactions";
import { useMatchTransfer, useRejectTransfer, useUnmatchTransfer } from "@/hooks/useTransfers";
import { amountToText } from "@/lib/amount-sign";
import { ApiError, errorCodeOf } from "@/lib/api";
import { formatShortDate } from "@/lib/balance-change";
import { toIsoDate } from "@/lib/dates";
import { showErrorToast } from "@/lib/error-toast";
import { applyFieldErrors, fieldErrorCode } from "@/lib/form-errors";
import { showsCategory, TRANSFER_COLOR, transferCaption } from "@/lib/transfers";

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
		? {
				date: defaultDate(openingDate),
				label: "",
				amount: "",
				notes: "",
				excluded: false,
				categoryId: null,
				merchantId: null,
				tagIds: [],
			}
		: {
				date: transaction.date,
				label: transaction.label,
				amount: amountToText(transaction.amount, transaction.currency),
				notes: transaction.notes ?? "",
				excluded: transaction.excluded,
				categoryId: transaction.categoryId,
				merchantId: transaction.merchantId,
				tagIds: transaction.tagIds,
			};
}

function sameTags(a: readonly string[], b: readonly string[]): boolean {
	const set = new Set(a);

	return set.size === b.length && b.every((id) => set.has(id));
}

/** The sheet's Catégorie field: the list's combobox behind a button showing the choice. */
function CategoryField({
	value,
	onChange,
	invalid,
	describedBy,
}: {
	value: string | null;
	onChange: (categoryId: string | null) => void;
	invalid: boolean;
	describedBy: string | undefined;
}) {
	const categories = useCategories();
	const [open, setOpen] = useState(false);
	const { color, name } = useCategoryShown(value);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					id="transaction-category"
					type="button"
					variant="outline"
					className="w-full justify-start font-normal"
					aria-invalid={invalid}
					{...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
				>
					<CategoryDot color={color} />
					{name === null ? (
						<Skeleton className="h-3 w-24" />
					) : (
						<span className="truncate">{name}</span>
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
				<CategoryCombobox
					categories={categories.data ?? []}
					value={value}
					onSelect={(categoryId) => {
						onChange(categoryId);
						setOpen(false);
					}}
				/>
			</PopoverContent>
		</Popover>
	);
}

/** The sheet's Marchand field: the list's combobox behind a button showing the choice. */
function MerchantField({
	value,
	onChange,
	invalid,
	describedBy,
}: {
	value: string | null;
	onChange: (merchantId: string | null) => void;
	invalid: boolean;
	describedBy: string | undefined;
}) {
	const { t } = useTranslation();
	const merchants = useMerchants();
	const [open, setOpen] = useState(false);
	const name =
		value === null
			? t("transactions.merchant.none")
			: merchants.data === undefined
				? null
				: (merchants.data.find((merchant) => merchant.id === value)?.name ??
					t("transactions.merchant.unknown"));

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					id="transaction-merchant"
					type="button"
					variant="outline"
					className="w-full justify-start font-normal"
					aria-invalid={invalid}
					{...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
				>
					{name === null ? (
						<Skeleton className="h-3 w-24" />
					) : (
						<span className="truncate">{name}</span>
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
				<MerchantCombobox
					merchants={merchants.data ?? []}
					value={value}
					onSelect={(merchantId) => {
						onChange(merchantId);
						setOpen(false);
					}}
				/>
			</PopoverContent>
		</Popover>
	);
}

const byName = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

/** The sheet's Étiquettes field: the list's combobox behind a button naming the tags. */
function TagsField({
	value,
	onChange,
	invalid,
	describedBy,
}: {
	value: string[];
	onChange: (tagIds: string[]) => void;
	invalid: boolean;
	describedBy: string | undefined;
}) {
	const { t } = useTranslation();
	const tags = useTags();
	const [open, setOpen] = useState(false);
	const names =
		tags.data === undefined
			? null
			: tags.data
					.filter((tag) => value.includes(tag.id))
					.map((tag) => tag.name)
					.toSorted((a, b) => byName.compare(a, b));

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					id="transaction-tags"
					type="button"
					variant="outline"
					className="w-full justify-start font-normal"
					aria-invalid={invalid}
					{...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
				>
					{names === null ? (
						<Skeleton className="h-3 w-24" />
					) : (
						<span className="truncate">
							{names.length === 0 ? t("transactions.tags.none") : names.join(", ")}
						</span>
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
				<TagCombobox
					tags={tags.data ?? []}
					value={value}
					onToggle={(tagId) =>
						onChange(value.includes(tagId) ? value.filter((id) => id !== tagId) : [...value, tagId])
					}
				/>
			</PopoverContent>
		</Popover>
	);
}

type TransferLink = TransactionData["transfer"];

/**
 * The sheet's « Virement » block: the other side, « Ne plus proposer » and
 * « Dissocier » for a transfer side, « Rapprocher un virement » for a standard
 * transaction, under a suggestion when it has several candidates. It
 * saves at once, apart from the form, so it keeps the link it last saved
 * rather than the row the sheet was opened with.
 */
function TransferBlock({
	transaction,
	transfer,
	onChange,
}: {
	transaction: TransactionData;
	transfer: TransferLink;
	onChange: (transfer: TransferLink) => void;
}) {
	const { t } = useTranslation();
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
						counterpartAccountId: candidate.accountId,
						counterpartAccountName: candidate.accountName,
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
					<p className="text-sm text-muted-foreground">
						{transaction.transfer === null && transaction.transferSuggested
							? t("transactions.transfer.suggestion")
							: t("transactions.transfer.none")}
					</p>
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
				</div>
			) : (
				<div className="flex items-center justify-between gap-4">
					<p className="flex min-w-0 flex-col text-sm">
						<span className="truncate">{t(caption.key, { account: caption.account })}</span>
						<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
							<CategoryDot color={TRANSFER_COLOR} />
							{t(`transactions.transfer.kinds.${transfer.kind}`)}
						</span>
					</p>
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
							onClick={() => undo(unmatchTransfer, transfer.id, "transactions.transfer.unmatched")}
						>
							{t("transactions.transfer.unmatch")}
						</Button>
					</div>
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
 * another tab hides the block rather than offering it again.
 */
function DuplicateBlock({
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
				<DuplicateFlag />
			</h3>
			<p className="text-sm text-muted-foreground">{t("transactions.duplicate.description")}</p>
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
		</section>
	);
}

/** A row's button in the page, found again after a refetch remounted it. */
const rowById = (id: string) =>
	document.querySelector<HTMLElement>(`[data-transaction-id="${CSS.escape(id)}"]`);

/**
 * The sheet's « Récurrence » block: adds the saved transaction to the
 * recurring patterns, confirmed, at once and apart from the form, as the
 * transfer block does. Hidden on a transfer side the API refuses.
 */
function RecurringBlock({
	transaction,
	dirty,
}: {
	transaction: TransactionData;
	/** Unsaved edits: the API would read the saved row, not what the form shows. */
	dirty: boolean;
}) {
	const { t } = useTranslation();
	const addRecurring = useAddRecurring();

	return (
		<section aria-labelledby="transaction-recurring-title" className="flex flex-col gap-1.5">
			<h3 id="transaction-recurring-title" className="text-sm font-medium">
				{t("transactions.recurring.title")}
			</h3>
			<div className="flex flex-col items-start gap-2">
				<p className="text-sm text-muted-foreground">{t("transactions.recurring.description")}</p>
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
			</div>
		</section>
	);
}

type TransactionFormProps = {
	account: SheetAccount;
	transaction: TransactionData | null;
	/** After a save or a delete. */
	onClose: () => void;
	/** After a merge: this transaction is gone, focus goes to the survivor's row. */
	onMerged: (survivorId: string) => void;
	/** Annuler: the sheet decides whether to ask first. */
	onCancel: () => void;
	onDirtyChange: (dirty: boolean) => void;
};

function TransactionForm({
	account,
	transaction,
	onClose,
	onMerged,
	onCancel,
	onDirtyChange,
}: TransactionFormProps) {
	const { t } = useTranslation();
	const createTransaction = useCreateTransaction(account.id);
	const updateTransaction = useUpdateTransaction(account.id);
	const deleteTransaction = useDeleteTransaction(account.id);
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const [transfer, setTransfer] = useState<TransferLink>(transaction?.transfer ?? null);
	// Hidden once resolved here; a refetch clearing the flag hides it too.
	const [duplicateHidden, setDuplicateHidden] = useState(false);
	const duplicate = transaction?.possibleDuplicate === true && !duplicateHidden;
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
						onMerged={onMerged}
						onResolved={() => setDuplicateHidden(true)}
						onGone={onClose}
					/>
				)}
				{transaction !== null && (
					<TransferBlock transaction={transaction} transfer={transfer} onChange={setTransfer} />
				)}
				{transaction !== null && showsCategory(transaction.amount, transfer) && (
					<RecurringBlock transaction={transaction} dirty={isDirty} />
				)}

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
