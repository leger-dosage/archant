import { useState } from "react";
import { useTranslation } from "react-i18next";

import { CategoryCombobox } from "@/components/CategoryCombobox";
import { MerchantCombobox } from "@/components/MerchantCombobox";
import { TagCombobox } from "@/components/TagCombobox";
import { TintedIcon } from "@/components/TintedIcon";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useCategories, useCategoryShown } from "@/hooks/useCategories";
import { useMerchants } from "@/hooks/useMerchants";
import { useTags } from "@/hooks/useTags";
import { cn } from "@/lib/utils";

/**
 * The sheet's Catégorie field: the list's combobox behind a button showing the choice,
 * creating a category as Sure's `DS::CategorySelect` does. A split's dialog holds one
 * per line, each with its own `id` and name. With `placeholder`, as in the bulk edit
 * drawer, `null` means « unchanged »: the button shows the placeholder, and the list
 * offers it first in place of « Sans catégorie », and no creation, as Sure's
 * `bulk_updates` select.
 */
export function CategoryField({
	id = "transaction-category",
	accessibleName,
	value,
	onChange,
	invalid,
	describedBy,
	setOnOutflow = false,
	placeholder,
}: {
	id?: string;
	/**
	 * Replaces the name its `<label>` gives, with the choice kept in it; `null`
	 * while the categories load.
	 */
	accessibleName?: (name: string | null) => string;
	value: string | null;
	onChange: (categoryId: string | null) => void;
	invalid: boolean;
	describedBy: string | undefined;
	/**
	 * The inflow of a loan payment or a contribution: `value` is its outflow's
	 * category, shown disabled with the reason, as Sure's `7e1d93613`.
	 */
	setOnOutflow?: boolean;
	/** Shown for `null`, which then means no choice yet rather than « Sans catégorie ». */
	placeholder?: string;
}) {
	const { t } = useTranslation();
	const categories = useCategories();
	const unchosen = placeholder !== undefined && value === null;
	const [open, setOpen] = useState(false);
	const { color, icon, name } = useCategoryShown(value);
	const noteId = `${id}-note`;
	const described = [describedBy, setOnOutflow ? noteId : undefined]
		.filter((part) => part !== undefined)
		.join(" ");

	return (
		<>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button
						id={id}
						type="button"
						variant="outline"
						disabled={setOnOutflow}
						className="w-full justify-start font-normal"
						aria-invalid={invalid}
						{...(accessibleName === undefined ? {} : { "aria-label": accessibleName(name) })}
						{...(described === "" ? {} : { "aria-describedby": described })}
					>
						{unchosen ? (
							<span className="truncate text-muted-foreground">{placeholder}</span>
						) : (
							<>
								<TintedIcon
									subject={
										color === null || icon === null
											? { kind: "uncategorised" }
											: { kind: "category", color, icon }
									}
									size="sm"
								/>
								{name === null ? (
									<Skeleton className="h-3 w-24" />
								) : (
									<span className="truncate">{name}</span>
								)}
							</>
						)}
					</Button>
				</PopoverTrigger>
				<PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
					<CategoryCombobox
						categories={categories.data ?? []}
						value={value}
						{...(placeholder === undefined ? { allowCreate: true } : { noneLabel: placeholder })}
						onSelect={(categoryId) => {
							onChange(categoryId);
							setOpen(false);
						}}
					/>
				</PopoverContent>
			</Popover>
			{setOnOutflow && (
				<p id={noteId} className="text-sm text-muted-foreground">
					{t("transactions.category.setOnOutflow")}
				</p>
			)}
		</>
	);
}

/**
 * The sheet's Marchand field: the list's combobox behind a button showing the choice.
 * With `placeholder`, as `CategoryField`'s: offered first in place of « Sans marchand », no creation.
 */
export function MerchantField({
	id = "transaction-merchant",
	disabled = false,
	value,
	onChange,
	invalid,
	describedBy,
	placeholder,
}: {
	id?: string;
	/** A split's line keeps its parent's merchant. */
	disabled?: boolean;
	/** Shown for `null`, which then means no choice yet rather than « Sans marchand ». */
	placeholder?: string;
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
			? (placeholder ?? t("transactions.merchant.none"))
			: merchants.data === undefined
				? null
				: (merchants.data.find((merchant) => merchant.id === value)?.name ??
					t("transactions.merchant.unknown"));

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					id={id}
					type="button"
					variant="outline"
					disabled={disabled}
					className={cn(
						"w-full justify-start font-normal",
						placeholder !== undefined && value === null && "text-muted-foreground",
					)}
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
					{...(placeholder === undefined ? {} : { noneLabel: placeholder, allowCreate: false })}
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

/**
 * The sheet's Étiquettes field: the list's combobox behind a button naming the tags.
 * The bulk edit drawer passes `placeholder` while the tags are unchanged, and
 * `onNone`, which offers « Aucune étiquette » first: the only way to clear them.
 */
export function TagsField({
	id = "transaction-tags",
	value,
	onChange,
	invalid,
	describedBy,
	placeholder,
	onNone,
}: {
	id?: string;
	/** Shown instead of « Aucune étiquette » for an empty set. */
	placeholder?: string;
	/** Offers « Aucune étiquette » first, marked while the set is empty without `placeholder`. */
	onNone?: () => void;
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
					id={id}
					type="button"
					variant="outline"
					className={cn(
						"w-full justify-start font-normal",
						placeholder !== undefined && value.length === 0 && "text-muted-foreground",
					)}
					aria-invalid={invalid}
					{...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
				>
					{names === null ? (
						<Skeleton className="h-3 w-24" />
					) : (
						<span className="truncate">
							{names.length === 0 ? (placeholder ?? t("transactions.tags.none")) : names.join(", ")}
						</span>
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
				<TagCombobox
					tags={tags.data ?? []}
					value={value}
					onToggle={(tagId) =>
						onChange(
							value.includes(tagId) ? value.filter((tag) => tag !== tagId) : [...value, tagId],
						)
					}
					{...(onNone === undefined
						? {}
						: { onNone, noneChecked: placeholder === undefined && value.length === 0 })}
				/>
			</PopoverContent>
		</Popover>
	);
}
