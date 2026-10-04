import type { SplitData } from "@/hooks/useTransactions";
import type { Nature } from "@/lib/amount-sign";
import type { FieldErrorCode } from "@/lib/form-errors";
import type { Path } from "react-hook-form";

import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useController, useFieldArray, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { SplitFormInput } from "@archant/api/schemas/transactions";
import { MAX_SPLIT_LINES, splitTransactionSchema } from "@archant/api/schemas/transactions";
import type { CurrencyCode, MinorUnits } from "@archant/data/money";
import { formatMoney, parseAmount, toMinorUnits } from "@archant/data/money";

import { AmountField } from "@/components/AmountField";
import { FieldMessage } from "@/components/FieldMessage";
import { Money } from "@/components/Money";
import { CategoryField } from "@/components/TransactionFields";
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
import { useEditSplit, useSplitTransaction } from "@/hooks/useTransactions";
import { amountToText } from "@/lib/amount-sign";
import { ApiError } from "@/lib/api";
import { formatShortDate } from "@/lib/balance-change";
import { showErrorToast } from "@/lib/error-toast";
import { applyFieldErrors, fieldErrorCode } from "@/lib/form-errors";
import { cn } from "@/lib/utils";

/** What the dialog reads of the transaction it splits. */
type SplitParent = {
	id: string;
	label: string;
	date: string;
	amount: MinorUnits;
	currency: string;
};

type SplitDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	parent: SplitParent;
	currency: CurrencyCode;
	/** The split's lines to edit, by id so their tags and notes stay; `null` for a new split. */
	lines: SplitData["children"] | null;
	/** After a save, with the parent's id: its row takes focus. */
	onSaved: (parentId: string) => void;
};

/** The fields of a line the API reports an error on by `lines.N.<field>`. */
type LineField = "label" | "amount" | "categoryId";

/** An error on the lines as a whole, or on a line's id, which no field shows. */
const onLines = (path: string) => path === "lines" || /^lines\.\d+\.id$/u.test(path);

const fieldId = (index: number, field: LineField) => `split-line-${String(index)}-${field}`;
const errorId = (index: number, field: LineField) => `${fieldId(index, field)}-error`;

function initialLines(parent: SplitParent, lines: SplitDialogProps["lines"]) {
	return lines === null
		? // Sure's first line: the parent's label, an amount to type, « Sans catégorie ».
			[{ label: parent.label, amount: "", categoryId: null }]
		: lines.map((line) => ({
				id: line.id,
				label: line.label,
				amount: amountToText(line.amount, line.currency),
				categoryId: line.categoryId,
			}));
}

/** One line's category, through the sheet's field, named after its line. */
function LineCategory({
	form,
	index,
}: {
	form: ReturnType<typeof useForm<SplitFormInput>>;
	index: number;
}) {
	const { t } = useTranslation();
	const category = useController({ control: form.control, name: `lines.${index}.categoryId` });
	const error = form.formState.errors.lines?.[index]?.categoryId;

	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={fieldId(index, "categoryId")}>{t("transactions.form.category")}</Label>
			<CategoryField
				id={fieldId(index, "categoryId")}
				accessibleName={(name) =>
					name === null
						? t("transactions.split.categoryOfLine", { index: index + 1 })
						: t("transactions.split.categoryOf", { index: index + 1, name })
				}
				value={category.field.value}
				onChange={category.field.onChange}
				invalid={error !== undefined}
				describedBy={error === undefined ? undefined : errorId(index, "categoryId")}
			/>
			<FieldMessage id={errorId(index, "categoryId")} error={error} />
		</div>
	);
}

/** One line's amount, its Dépense / Revenu toggle starting on the parent's for a new line. */
function LineAmount({
	form,
	index,
	nature,
}: {
	form: ReturnType<typeof useForm<SplitFormInput>>;
	index: number;
	nature: Nature;
}) {
	const { t } = useTranslation();
	const amount = useController({ control: form.control, name: `lines.${index}.amount` });
	const error = form.formState.errors.lines?.[index]?.amount;

	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={fieldId(index, "amount")}>
				{t("transactions.form.amount")}
				<span className="sr-only"> {t("transactions.split.ofLine", { index: index + 1 })}</span>
			</Label>
			<AmountField
				id={fieldId(index, "amount")}
				value={amount.field.value}
				onChange={amount.field.onChange}
				onBlur={amount.field.onBlur}
				invalid={error !== undefined}
				defaultNature={nature}
				natureLabel={t("transactions.split.natureOf", { index: index + 1 })}
				{...(error === undefined ? {} : { describedBy: errorId(index, "amount") })}
			/>
			<FieldMessage id={errorId(index, "amount")} error={error} />
		</div>
	);
}

/**
 * The form, mounted only while the dialog is open, so each opening starts
 * from the split as it stands: a refused split's lines do not outlive it.
 */
function SplitForm({
	parent,
	currency,
	lines,
	onOpenChange,
	onSaved,
}: Omit<SplitDialogProps, "open">) {
	const { t } = useTranslation();
	const splitTransaction = useSplitTransaction();
	const editSplit = useEditSplit();
	const editing = lines !== null;
	const schema = useMemo(() => splitTransactionSchema(currency), [currency]);
	const form = useForm<SplitFormInput>({
		// `raw` hands the typed text to the API as is: the same schema parses it
		// there, into minor units of the account's currency.
		resolver: zodResolver(schema, undefined, { raw: true }),
		defaultValues: { lines: initialLines(parent, lines) },
	});
	// `key`, not `id`: a line's `id` names the child it keeps.
	const rows = useFieldArray({ control: form.control, name: "lines", keyName: "key" });
	const watched = useWatch({ control: form.control, name: "lines" });
	// An empty or invalid amount counts for nothing until it reads as one.
	const allocated = watched.reduce(
		(total, line) => total + (parseAmount(line.amount, currency) ?? 0),
		0,
	);
	const remaining = toMinorUnits(parent.amount - allocated);
	const balanced = remaining === 0;
	// An error the API reports on the lines as a whole, under the counter.
	const [linesError, setLinesError] = useState<FieldErrorCode | null>(null);
	const { errors, isSubmitting } = form.formState;
	// A zero parent starts its lines on Dépense, as an empty amount field does.
	const nature: Nature = parent.amount > 0 ? "income" : "expense";

	const linesMessage = (code: FieldErrorCode) =>
		code === "too_small"
			? t("transactions.split.tooFew")
			: code === "too_big"
				? t("transactions.split.tooMany", { max: MAX_SPLIT_LINES })
				: t(`errors.fields.${code}`);

	const showError = (error: unknown) => {
		const apiError = error instanceof ApiError ? error : new ApiError("INTERNAL_ERROR");
		const fieldNames: Path<SplitFormInput>[] = rows.fields.flatMap(
			(_, index) =>
				[`lines.${index}.label`, `lines.${index}.amount`, `lines.${index}.categoryId`] as const,
		);
		const unplaced = applyFieldErrors(apiError.fields, fieldNames, form.setError);
		const linesField = unplaced.find((field) => onLines(field.path));
		const left = unplaced.filter((field) => !onLines(field.path));

		if (linesField !== undefined) {
			setLinesError(fieldErrorCode({ type: linesField.code }));
		}

		if (apiError.code !== "VALIDATION_ERROR" || apiError.fields.length === 0 || left.length > 0) {
			showErrorToast(apiError.code);
		}
	};

	const submit = form.handleSubmit(async (values) => {
		setLinesError(null);

		try {
			const saved = editing
				? await editSplit.mutateAsync({ id: parent.id, input: values })
				: await splitTransaction.mutateAsync({ id: parent.id, input: values });

			toast.success(t(editing ? "transactions.split.edited" : "transactions.split.created"));
			onOpenChange(false);
			onSaved(saved.parent.id);
		} catch (error) {
			showError(error);
		}
	});

	return (
		<>
			<DialogHeader>
				<DialogTitle>
					{t(editing ? "transactions.split.editTitle" : "transactions.split.title")}
				</DialogTitle>
				<DialogDescription>
					{t("transactions.split.description", {
						label: parent.label,
						date: formatShortDate(parent.date),
						amount: formatMoney({ amount: parent.amount, currency: parent.currency }),
					})}
				</DialogDescription>
			</DialogHeader>
			<form
				id="split-form"
				noValidate
				className="flex flex-col gap-3"
				onSubmit={(event) => void submit(event)}
			>
				{rows.fields.map((row, index) => {
					const labelError = errors.lines?.[index]?.label;

					return (
						<fieldset key={row.key} className="relative flex flex-col gap-3 rounded-lg border p-3">
							{/* The fieldset's first child, so it names the group. */}
							<legend className="float-left flex h-8 items-center text-sm font-medium">
								{t("transactions.split.line", { index: index + 1 })}
							</legend>
							{index > 0 && (
								<Button
									type="button"
									variant="ghost"
									size="icon"
									className="absolute top-3 right-3 size-8"
									// The API's `lines.N` errors name the lines as sent.
									disabled={isSubmitting}
									aria-label={t("transactions.split.remove", { index: index + 1 })}
									onClick={() => rows.remove(index)}
								>
									<XIcon aria-hidden="true" />
								</Button>
							)}
							<div className="flex flex-col gap-1.5">
								<Label htmlFor={fieldId(index, "label")}>
									{t("transactions.form.label")}
									<span className="sr-only">
										{" "}
										{t("transactions.split.ofLine", { index: index + 1 })}
									</span>
								</Label>
								<Input
									id={fieldId(index, "label")}
									autoComplete="off"
									aria-invalid={labelError !== undefined}
									{...(labelError === undefined
										? {}
										: { "aria-describedby": errorId(index, "label") })}
									{...form.register(`lines.${index}.label`)}
								/>
								<FieldMessage id={errorId(index, "label")} error={labelError} />
							</div>
							<div className="grid gap-3 sm:grid-cols-2">
								<LineAmount form={form} index={index} nature={nature} />
								<LineCategory form={form} index={index} />
							</div>
						</fieldset>
					);
				})}

				<Button
					type="button"
					variant="outline"
					className="border-dashed"
					disabled={rows.fields.length >= MAX_SPLIT_LINES || isSubmitting}
					onClick={() => rows.append({ label: "", amount: "", categoryId: null })}
				>
					<PlusIcon aria-hidden="true" />
					{t("transactions.split.add")}
				</Button>

				<div
					data-slot="split-remaining"
					className={cn(
						"flex flex-col gap-1 rounded-lg border p-3 text-sm",
						!balanced && "border-destructive",
					)}
				>
					<p aria-live="polite" className="flex items-center justify-between gap-4">
						<span className="font-medium">{t("transactions.split.remaining")}</span>
						<Money
							amount={remaining}
							currency={parent.currency}
							{...(balanced ? {} : { className: "text-destructive" })}
						/>
					</p>
					{!balanced && (
						<p className="text-xs text-destructive">{t("errors.fields.split_sum_mismatch")}</p>
					)}
					{linesError !== null && (balanced || linesError !== "split_sum_mismatch") && (
						<p role="alert" className="text-xs text-destructive">
							{linesMessage(linesError)}
						</p>
					)}
				</div>
			</form>
			<DialogFooter>
				<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
					{t("common.cancel")}
				</Button>
				<Button type="submit" form="split-form" disabled={!balanced || isSubmitting}>
					{t(editing ? "transactions.form.save" : "transactions.split.submit")}
				</Button>
			</DialogFooter>
		</>
	);
}

/**
 * Sure's split dialog: a line per part of the transaction, each with its
 * label, amount and category, and « Reste à répartir » until the lines sum
 * to the transaction, when « Diviser » turns on. An edit lists the split's
 * lines by id, so each keeps its tags and notes.
 */
export function SplitDialog({ open, onOpenChange, ...props }: SplitDialogProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				showCloseButton={false}
				className="max-h-[90vh] overflow-y-auto sm:max-w-[550px]"
			>
				{open && <SplitForm {...props} onOpenChange={onOpenChange} />}
			</DialogContent>
		</Dialog>
	);
}
