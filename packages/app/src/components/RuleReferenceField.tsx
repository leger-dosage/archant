import type { LeafType, Options } from "@/lib/rule-form";
import type { ReactNode } from "react";

import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { CategoryIcon } from "@archant/data/category-presets";
import type { RuleActionType } from "@archant/data/rules";

import { CategoryCombobox } from "@/components/CategoryCombobox";
import { CategoryPill } from "@/components/CategoryPill";
import { MerchantCombobox } from "@/components/MerchantCombobox";
import { TagCombobox } from "@/components/TagCombobox";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

/**
 * A button showing the chosen merchant, category or tag, opening its
 * combobox in a popover; `children` gets the function that closes it.
 */
function PickerField({
	id,
	label,
	chosen,
	placeholder,
	deleted,
	invalid,
	describedBy,
	children,
}: {
	id: string;
	label: string;
	/**
	 * The picked row's name, with a category's colour and icon; `undefined`
	 * when none is picked or it was deleted.
	 */
	chosen: { name: string; color?: string; icon?: CategoryIcon } | undefined;
	placeholder: string;
	/** Shown instead of the placeholder when an id is set but names no row. */
	deleted: string | null;
	invalid: boolean;
	describedBy: { "aria-describedby"?: string };
	children: (close: () => void) => ReactNode;
}) {
	const [open, setOpen] = useState(false);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					id={id}
					type="button"
					variant="outline"
					className="w-full min-w-0 justify-start font-normal"
					aria-label={label}
					aria-invalid={invalid}
					{...describedBy}
				>
					{chosen === undefined ? (
						<span className="text-muted-foreground">{deleted ?? placeholder}</span>
					) : chosen.color !== undefined && chosen.icon !== undefined ? (
						<CategoryPill
							category={{ name: chosen.name, color: chosen.color, icon: chosen.icon }}
						/>
					) : (
						<span className="truncate">{chosen.name}</span>
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-64 p-0">
				{children(() => setOpen(false))}
			</PopoverContent>
		</Popover>
	);
}

/** The text a picker shows for a set id that names no row any more, `null` when unset. */
const deletedText = (value: string | null | undefined, text: string) =>
	value === "" || value === null || value === undefined ? null : text;

/** The row a condition or an action names, by its table. */
type ReferenceKind = "account" | "merchant" | "category" | "tag";

export const LEAF_REFERENCES = {
	transaction_account: "account",
	transaction_merchant: "merchant",
	transaction_category: "category",
	transaction_tag: "tag",
} as const satisfies Partial<Record<LeafType, ReferenceKind>>;

export const ACTION_REFERENCES = {
	set_transaction_category: "category",
	set_transaction_merchant: "merchant",
	set_transaction_tags: "tag",
	set_as_transfer_or_payment: "account",
} as const satisfies Partial<Record<RuleActionType, ReferenceKind>>;

/**
 * The value naming an account, a merchant, a category or a tag: a select for
 * an account, a combobox behind a button for the others. Shared by conditions
 * and actions.
 */
export function ReferenceField({
	kind,
	id,
	label,
	value,
	onPick,
	invalid,
	describedBy,
	options,
}: {
	kind: ReferenceKind;
	id: string;
	label: string;
	/** The picked id, `""` for none. */
	value: string;
	onPick: (id: string) => void;
	invalid: boolean;
	describedBy: { "aria-describedby"?: string };
	options: Options;
}) {
	const { t } = useTranslation();
	const pickerProps = { id, label, invalid, describedBy };
	const picked = value === "" ? undefined : value;

	switch (kind) {
		case "account":
			return (
				<Select value={value} onValueChange={onPick}>
					<SelectTrigger
						id={id}
						className="w-full"
						aria-label={label}
						aria-invalid={invalid}
						{...describedBy}
					>
						{/* A deleted account is in no option: say so rather than show the empty placeholder. */}
						{value !== "" && !options.accounts.some((account) => account.id === value) ? (
							<span>{t("rules.summary.deletedAccount")}</span>
						) : (
							<SelectValue placeholder={t("rules.form.accountPlaceholder")} />
						)}
					</SelectTrigger>
					<SelectContent>
						{options.accounts.map((account) => (
							<SelectItem key={account.id} value={account.id}>
								{account.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			);
		case "merchant":
			return (
				<PickerField
					{...pickerProps}
					chosen={options.merchants.find((candidate) => candidate.id === value)}
					placeholder={t("rules.form.merchantPlaceholder")}
					deleted={deletedText(value, t("rules.summary.deletedMerchant"))}
				>
					{(close) => (
						<MerchantCombobox
							merchants={options.merchants}
							value={picked}
							allowNone={false}
							onSelect={(merchantId) => {
								onPick(merchantId ?? "");
								close();
							}}
						/>
					)}
				</PickerField>
			);
		case "category":
			return (
				<PickerField
					{...pickerProps}
					chosen={options.categories.find((candidate) => candidate.id === value)}
					placeholder={t("rules.form.categoryPlaceholder")}
					deleted={deletedText(value, t("rules.summary.deletedCategory"))}
				>
					{(close) => (
						<CategoryCombobox
							categories={options.categories}
							value={picked}
							allowNone={false}
							allowCreate
							onSelect={(categoryId) => {
								onPick(categoryId ?? "");
								close();
							}}
						/>
					)}
				</PickerField>
			);
		default:
			return (
				<PickerField
					{...pickerProps}
					chosen={options.tags.find((candidate) => candidate.id === value)}
					placeholder={t("rules.form.tagPlaceholder")}
					deleted={deletedText(value, t("rules.summary.deletedTag"))}
				>
					{(close) => (
						<TagCombobox
							tags={options.tags}
							value={picked === undefined ? [] : [picked]}
							onToggle={(tagId) => {
								onPick(tagId);
								close();
							}}
						/>
					)}
				</PickerField>
			);
	}
}
