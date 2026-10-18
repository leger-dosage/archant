import type { BulkSelectionInput } from "@/hooks/useTransactions";
import type { ShownError } from "@/lib/form-errors";
import type { FormEvent } from "react";

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { DateField } from "@/components/DateField";
import { FieldMessage } from "@/components/FieldMessage";
import { InsetGroup } from "@/components/InsetGroup";
import { CategoryField, MerchantField, TagsField } from "@/components/TransactionFields";
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
import { useBulkUpdateTransactions } from "@/hooks/useTransactions";
import { ApiError } from "@/lib/api";
import { toIsoDate } from "@/lib/dates";

/** The fields whose refusal shows under them; any other goes to the hook's toast alone. */
type TextField = "date" | "name" | "notes";

type BulkEditSheetProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	selection: BulkSelectionInput;
	/** Called with how many rows the API matched, once it saved. */
	onSaved: (updated: number) => void;
};

/**
 * Sure's `transactions/bulk_updates/new` drawer: « Aperçu » with the date,
 * then « Opérations » with the label, the category, the merchant, the tags
 * and the notes. A field left empty changes nothing, as Sure's
 * `compact_blank`; the tags replace each row's only once touched, as Sure's
 * `tags_provided?`. Nothing filled closes it without a request.
 */
export function BulkEditSheet({ open, onOpenChange, selection, onSaved }: BulkEditSheetProps) {
	const { t } = useTranslation();

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent
				// Sure's drawer, framed as `TransactionSheet`.
				className="data-[side=right]:w-full data-[side=right]:border-l-0 data-[side=right]:sm:max-w-none data-[side=right]:md:inset-y-3 data-[side=right]:md:right-3 data-[side=right]:md:h-auto data-[side=right]:md:w-[550px] data-[side=right]:md:rounded-xl data-[side=right]:md:border motion-reduce:transition-none motion-reduce:data-open:animate-none motion-reduce:data-closed:animate-none"
			>
				<SheetHeader className="border-b">
					<SheetTitle>{t("operations.bulk.editTitle")}</SheetTitle>
					<SheetDescription>{t("operations.bulk.editDescription")}</SheetDescription>
				</SheetHeader>
				{/* Mounted with the sheet's content, so each opening starts empty. */}
				<BulkEditForm
					selection={selection}
					onCancel={() => onOpenChange(false)}
					onSaved={onSaved}
					onClose={() => onOpenChange(false)}
				/>
			</SheetContent>
		</Sheet>
	);
}

function BulkEditForm({
	selection,
	onCancel,
	onSaved,
	onClose,
}: {
	selection: BulkSelectionInput;
	onCancel: () => void;
	onSaved: (updated: number) => void;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const update = useBulkUpdateTransactions();
	const [date, setDate] = useState("");
	const [name, setName] = useState("");
	const [notes, setNotes] = useState("");
	const [categoryId, setCategoryId] = useState<string | null>(null);
	const [merchantId, setMerchantId] = useState<string | null>(null);
	// `undefined` leaves each row's tags; `[]`, set by « Aucune étiquette » only, clears them.
	const [tagIds, setTagIds] = useState<string[] | undefined>(undefined);
	const [errors, setErrors] = useState<Partial<Record<TextField, ShownError>>>({});

	const describedBy = (field: TextField) =>
		errors[field] === undefined ? {} : { "aria-describedby": `bulk-${field}-error` };

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		const patch = {
			...(date.trim() === "" ? {} : { date }),
			...(name.trim() === "" ? {} : { name }),
			...(notes.trim() === "" ? {} : { notes }),
			...(categoryId === null ? {} : { categoryId }),
			...(merchantId === null ? {} : { merchantId }),
			...(tagIds === undefined ? {} : { tagIds }),
		};

		// The API refuses an empty patch; Sure posts it and reports 0.
		if (Object.keys(patch).length === 0) {
			onClose();

			return;
		}

		setErrors({});

		try {
			const { updated } = await update.mutateAsync({ ...selection, patch });
			onClose();
			onSaved(updated);
		} catch (error) {
			// The hook shows the toast; the selection stays for another try.
			if (error instanceof ApiError) {
				setErrors(
					Object.fromEntries(
						error.fields.flatMap((field) => {
							const key = field.path.replace(/^patch\./u, "");

							return key === "date" || key === "name" || key === "notes"
								? [[key, { type: field.code }]]
								: [];
						}),
					),
				);
			}
		}
	};

	return (
		<>
			<form
				id="bulk-edit-form"
				noValidate
				className="flex flex-1 flex-col gap-4 overflow-y-auto px-4"
				onSubmit={(event) => void submit(event)}
			>
				<InsetGroup level={3} title={t("operations.bulk.overview")}>
					<div className="flex flex-col gap-1.5 p-4">
						<Label htmlFor="bulk-date">{t("transactions.form.date")}</Label>
						<DateField
							id="bulk-date"
							value={date}
							onChange={setDate}
							max={toIsoDate()}
							invalid={errors.date !== undefined}
							{...(errors.date === undefined ? {} : { describedBy: "bulk-date-error" })}
						/>
						<FieldMessage id="bulk-date-error" error={errors.date} />
					</div>
				</InsetGroup>

				<InsetGroup level={3} title={t("operations.bulk.transactions")}>
					<div className="flex flex-col gap-4 p-4">
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="bulk-name">{t("transactions.form.label")}</Label>
							<Input
								id="bulk-name"
								autoComplete="off"
								placeholder={t("operations.bulk.namePlaceholder")}
								value={name}
								onChange={(event) => setName(event.target.value)}
								aria-invalid={errors.name !== undefined}
								{...describedBy("name")}
							/>
							<FieldMessage id="bulk-name-error" error={errors.name} />
						</div>

						<div className="flex flex-col gap-1.5">
							<Label htmlFor="bulk-category">{t("transactions.form.category")}</Label>
							<CategoryField
								id="bulk-category"
								value={categoryId}
								onChange={setCategoryId}
								invalid={false}
								describedBy={undefined}
								placeholder={t("operations.bulk.categoryPlaceholder")}
							/>
						</div>

						<div className="flex flex-col gap-1.5">
							<Label htmlFor="bulk-merchant">{t("transactions.form.merchant")}</Label>
							<MerchantField
								id="bulk-merchant"
								value={merchantId}
								onChange={setMerchantId}
								invalid={false}
								describedBy={undefined}
								placeholder={t("operations.bulk.merchantPlaceholder")}
							/>
						</div>

						<div className="flex flex-col gap-1.5">
							<Label htmlFor="bulk-tags">{t("transactions.form.tags")}</Label>
							<TagsField
								id="bulk-tags"
								value={tagIds ?? []}
								// A set emptied by unticking is « unchanged » again, as in Sure's
								// select, where only the blank option clears.
								onChange={(next) => setTagIds(next.length === 0 ? undefined : next)}
								onNone={() => setTagIds([])}
								invalid={false}
								describedBy={undefined}
								{...(tagIds === undefined
									? { placeholder: t("operations.bulk.tagsPlaceholder") }
									: {})}
							/>
						</div>

						<div className="flex flex-col gap-1.5">
							<Label htmlFor="bulk-notes">{t("transactions.form.notes")}</Label>
							<textarea
								id="bulk-notes"
								rows={5}
								placeholder={t("operations.bulk.notesPlaceholder")}
								className="min-h-20 w-full rounded-sm border border-input bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30"
								value={notes}
								onChange={(event) => setNotes(event.target.value)}
								aria-invalid={errors.notes !== undefined}
								{...describedBy("notes")}
							/>
							<FieldMessage id="bulk-notes-error" error={errors.notes} />
						</div>
					</div>
				</InsetGroup>
			</form>

			<SheetFooter className="flex-row justify-end gap-2 border-t">
				<Button type="button" variant="outline" onClick={onCancel}>
					{t("common.cancel")}
				</Button>
				<Button type="submit" form="bulk-edit-form" disabled={update.isPending}>
					{t("transactions.form.save")}
				</Button>
			</SheetFooter>
		</>
	);
}
