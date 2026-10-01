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

/** The sheet's Catégorie field: the list's combobox behind a button showing the choice. */
export function CategoryField({
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
	const { color, icon, name } = useCategoryShown(value);

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
export function MerchantField({
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
export function TagsField({
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
