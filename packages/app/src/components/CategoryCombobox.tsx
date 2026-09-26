import type { CategoryData } from "@/hooks/useCategories";

import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { CATEGORY_NAME_MAX_LENGTH } from "@archant/data/category-presets";

import { CategoryDot } from "@/components/CategoryDot";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { useCreateCategory } from "@/hooks/useCategories";
import { errorCodeOf } from "@/lib/api";
import { categoryTree } from "@/lib/category-tree";
import { showErrorToast } from "@/lib/error-toast";
import { isNewName } from "@/lib/name-key";
import { newCategory } from "@/lib/new-category";
import { matchesSearch } from "@/lib/search-match";

// cmdk matches on an item's value; ids keep two items apart whatever their
// names, and the filter reads the name from the keywords instead.
const NONE = "none";
const CREATE = "create";

/** Case and accents aside, in list order: `Enter` picks the first match as the user reads it. */
function filterByName(value: string, search: string, keywords: string[] = []): number {
	// « Créer » names exactly what was typed, so it always matches.
	return value === CREATE || matchesSearch(keywords.join(" "), search) ? 1 : 0;
}

type CategoryComboboxProps = {
	categories: readonly CategoryData[];
	/**
	 * The current category, marked in the list; `null` for « Sans catégorie », `undefined`
	 * for none marked, as for several rows at once.
	 */
	value: string | null | undefined;
	onSelect: (categoryId: string | null) => void;
	/** Offers « Sans catégorie » first; a rule's action has no such choice. */
	allowNone?: boolean;
	/**
	 * Offers « Créer "…" » last, making a top-level expense category with the
	 * form's defaults. Only the rule dialog does: it cannot stack the category
	 * form over itself, and a transaction's category is best picked, not made
	 * up on the spot.
	 */
	allowCreate?: boolean;
};

/**
 * A single-choice category list to type into: « Sans catégorie » first, then
 * each parent followed by its children, indented, and « Créer "…" » last when
 * allowed and no category holds the typed name. Arrows move, `Enter` picks.
 * The caller puts it in a popover and closes it on `onSelect`.
 */
export function CategoryCombobox({
	categories,
	value,
	onSelect,
	allowNone = true,
	allowCreate = false,
}: CategoryComboboxProps) {
	const { t } = useTranslation();
	const createCategory = useCreateCategory();
	const [search, setSearch] = useState("");
	const none = t("transactions.category.none");
	const typed = search.trim();
	const canCreate =
		allowCreate &&
		isNewName(
			typed,
			categories.map((category) => category.name),
			CATEGORY_NAME_MAX_LENGTH,
		);

	const create = () => {
		if (createCategory.isPending) {
			return;
		}

		createCategory.mutate(newCategory(typed), {
			onSuccess: (category) => onSelect(category.id),
			onError: (error) => showErrorToast(errorCodeOf(error)),
		});
	};

	const item = (category: CategoryData, child: boolean) => (
		<CommandItem
			key={category.id}
			value={category.id}
			keywords={[category.name]}
			data-checked={category.id === value}
			className={child ? "pl-6" : undefined}
			onSelect={() => onSelect(category.id)}
		>
			<CategoryDot color={category.color} />
			<span className="truncate">{category.name}</span>
		</CommandItem>
	);

	return (
		<Command filter={filterByName} loop>
			<CommandInput
				aria-label={t("transactions.category.search")}
				placeholder={t("transactions.category.search")}
				value={search}
				onValueChange={setSearch}
			/>
			<CommandList>
				<CommandEmpty>{t("transactions.category.empty")}</CommandEmpty>
				<CommandGroup>
					{allowNone && (
						<CommandItem
							value={NONE}
							keywords={[none]}
							data-checked={value === null}
							onSelect={() => onSelect(null)}
						>
							<CategoryDot color={null} />
							<span>{none}</span>
						</CommandItem>
					)}
					{categoryTree(categories).flatMap(({ parent, children }) => [
						item(parent, false),
						...children.map((child) => item(child, true)),
					])}
					{canCreate && (
						<CommandItem value={CREATE} disabled={createCategory.isPending} onSelect={create}>
							<PlusIcon aria-hidden="true" />
							<span className="truncate">{t("transactions.category.create", { name: typed })}</span>
						</CommandItem>
					)}
				</CommandGroup>
			</CommandList>
		</Command>
	);
}
