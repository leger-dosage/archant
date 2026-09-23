import type { CategoryData } from "@/hooks/useCategories";

import { useTranslation } from "react-i18next";

import { CategoryDot } from "@/components/CategoryDot";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { categoryTree } from "@/lib/category-tree";
import { matchesCommand } from "@/lib/shortcuts";

// cmdk matches on an item's value; ids keep two items apart whatever their
// names, and the filter reads the name from the keywords instead.
const NONE = "none";

/** Case and accents aside, in list order: `Enter` picks the first match as the user reads it. */
function filterByName(_value: string, search: string, keywords: string[] = []): number {
	return matchesCommand(keywords.join(" "), search) ? 1 : 0;
}

type CategoryComboboxProps = {
	categories: readonly CategoryData[];
	/**
	 * The current category, marked in the list; `null` for « Sans catégorie », `undefined`
	 * for none marked, as for several rows at once.
	 */
	value: string | null | undefined;
	onSelect: (categoryId: string | null) => void;
};

/**
 * A single-choice category list to type into: « Sans catégorie » first, then
 * each parent followed by its children, indented. Arrows move, `Enter` picks.
 * The caller puts it in a popover and closes it on `onSelect`.
 */
export function CategoryCombobox({ categories, value, onSelect }: CategoryComboboxProps) {
	const { t } = useTranslation();
	const none = t("transactions.category.none");
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
			/>
			<CommandList>
				<CommandEmpty>{t("transactions.category.empty")}</CommandEmpty>
				<CommandGroup>
					<CommandItem
						value={NONE}
						keywords={[none]}
						data-checked={value === null}
						onSelect={() => onSelect(null)}
					>
						<CategoryDot color={null} />
						<span>{none}</span>
					</CommandItem>
					{categoryTree(categories).flatMap(({ parent, children }) => [
						item(parent, false),
						...children.map((child) => item(child, true)),
					])}
				</CommandGroup>
			</CommandList>
		</Command>
	);
}
