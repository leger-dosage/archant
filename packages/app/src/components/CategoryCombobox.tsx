import type { CategoryData } from "@/hooks/useCategories";

import { ArrowLeftIcon, CornerDownRightIcon, PlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { CategoryColor } from "@archant/data/category-presets";
import {
	CATEGORY_COLORS,
	CATEGORY_NAME_MAX_LENGTH,
	newCategory,
} from "@archant/data/category-presets";

import { TintedIcon } from "@/components/TintedIcon";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { useCreateCategory } from "@/hooks/useCategories";
import { categoryTree } from "@/lib/category-tree";
import { isNewName, nameKey } from "@/lib/name-key";
import { filterByName } from "@/lib/search-match";

// cmdk matches on an item's value; ids keep two items apart whatever their
// names, and the filter reads the name from the keywords instead.
const NONE = "none";
const CREATE = "create";
const CREATE_CHILD = "create-child";
const BACK = "back";

// « Créer » and « Ajouter comme sous-catégorie… » name exactly what was typed, so they always match.
const filterOptions = filterByName([CREATE, CREATE_CHILD]);

/** A category this picker created, so « Créer » again assigns it rather than posting a twin. */
type Created = { name: string; parentId: string | null; id: string };

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
	 * Names the first choice, which still picks `null`, in place of « Sans
	 * catégorie »: the bulk edit drawer's « unchanged », as Sure's select prompt.
	 */
	noneLabel?: string;
	/**
	 * Offers « Créer « … » » and « Ajouter comme sous-catégorie… » last, as
	 * Sure's `DS::CategorySelect` and quick picker: a top-level category, or
	 * a child of the parent picked next, which takes that parent's colour.
	 * « Réglages › Catégories » edits the rest later.
	 */
	allowCreate?: boolean;
	/** A new top-level category's colour: the first swatch, as Sure's form, unless the caller picks. */
	createColor?: () => CategoryColor;
	/**
	 * Receives the id of a category created here, `onSelect` otherwise. Picked
	 * again with the same name and parent, « Créer » passes the same id again
	 * and posts nothing, for a caller whose assignment failed.
	 */
	onCreate?: (categoryId: string) => void;
	/** Shown above the list while the caller keeps it open, as an assignment that failed. */
	error?: string | null;
};

/**
 * A single-choice category list to type into: « Sans catégorie » first, then
 * each parent followed by its children, indented, and the creation choices
 * last when allowed and no category holds the typed name. « Ajouter comme
 * sous-catégorie… » swaps the list for the top-level categories, « Retour »
 * first; `Escape` or editing the text goes back. Arrows move, `Enter`
 * picks. The caller puts it in a popover and closes it on `onSelect`.
 */
export function CategoryCombobox({
	categories,
	value,
	onSelect,
	allowNone = true,
	noneLabel,
	allowCreate = false,
	createColor = () => CATEGORY_COLORS[0],
	onCreate = onSelect,
	error = null,
}: CategoryComboboxProps) {
	const { t } = useTranslation();
	const createCategory = useCreateCategory();
	const [search, setSearch] = useState("");
	const [choosingParent, setChoosingParent] = useState(false);
	const [created, setCreated] = useState<Created | null>(null);
	const none = noneLabel ?? t("transactions.category.none");
	const typed = search.trim();
	const remembered = created !== null && nameKey(created.name) === nameKey(typed);
	const canCreate =
		allowCreate &&
		(remembered ||
			isNewName(
				typed,
				categories.map((category) => category.name),
				CATEGORY_NAME_MAX_LENGTH,
			));
	const topLevel = categoryTree(categories)
		.map(({ parent }) => parent)
		.filter((category) => category.parentId === null);
	const parentStep = canCreate && choosingParent;

	// Radix closes the popover on `Escape` in a capture listener on the
	// document; one on the window runs first and keeps it open to go back.
	useEffect(() => {
		if (!parentStep) {
			return undefined;
		}

		const back = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				setChoosingParent(false);
			}
		};

		window.addEventListener("keydown", back, { capture: true });

		return () => window.removeEventListener("keydown", back, { capture: true });
	}, [parentStep]);

	const create = (parentId: string | null) => {
		if (createCategory.isPending) {
			return;
		}

		if (remembered && created.parentId === parentId) {
			onCreate(created.id);

			return;
		}

		createCategory.mutate(
			{ ...newCategory(typed), color: createColor(), parentId },
			{
				onSuccess: (category) => {
					setCreated({ name: typed, parentId, id: category.id });
					onCreate(category.id);
				},
				onError: () => toast.error(t("transactions.category.createError")),
			},
		);
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
			<TintedIcon
				subject={{ kind: "category", color: category.color, icon: category.icon }}
				size="sm"
			/>
			<span className="truncate">{category.name}</span>
		</CommandItem>
	);

	return (
		<Command filter={filterOptions} shouldFilter={!parentStep} loop>
			<CommandInput
				aria-label={t("transactions.category.search")}
				placeholder={t("transactions.category.search")}
				value={search}
				onValueChange={(next) => {
					setSearch(next);
					setChoosingParent(false);
				}}
			/>
			{error !== null && (
				<p role="alert" className="px-3 pt-2 text-sm text-destructive">
					{error}
				</p>
			)}
			<CommandList>
				<CommandEmpty>{t("transactions.category.empty")}</CommandEmpty>
				{parentStep ? (
					<CommandGroup heading={t("transactions.category.createIn", { name: typed })}>
						<CommandItem value={BACK} onSelect={() => setChoosingParent(false)}>
							<ArrowLeftIcon aria-hidden="true" />
							<span>{t("transactions.category.back")}</span>
						</CommandItem>
						{topLevel.map((parent) => (
							<CommandItem
								key={parent.id}
								value={`parent-${parent.id}`}
								disabled={createCategory.isPending}
								onSelect={() => create(parent.id)}
							>
								<TintedIcon
									subject={{ kind: "category", color: parent.color, icon: parent.icon }}
									size="sm"
								/>
								<span className="truncate">{parent.name}</span>
							</CommandItem>
						))}
					</CommandGroup>
				) : (
					<CommandGroup>
						{allowNone && (
							<CommandItem
								value={NONE}
								keywords={[none]}
								data-checked={value === null}
								onSelect={() => onSelect(null)}
							>
								{noneLabel === undefined && (
									<TintedIcon subject={{ kind: "uncategorised" }} size="sm" />
								)}
								<span>{none}</span>
							</CommandItem>
						)}
						{categoryTree(categories).flatMap(({ parent, children }) => [
							item(parent, false),
							...children.map((child) => item(child, true)),
						])}
						{canCreate && (
							<CommandItem
								value={CREATE}
								disabled={createCategory.isPending}
								onSelect={() => create(null)}
							>
								<PlusIcon aria-hidden="true" />
								<span className="truncate">
									{t("transactions.category.create", { name: typed })}
								</span>
							</CommandItem>
						)}
						{canCreate && topLevel.length > 0 && (
							<CommandItem
								value={CREATE_CHILD}
								disabled={createCategory.isPending}
								onSelect={() => setChoosingParent(true)}
							>
								<CornerDownRightIcon aria-hidden="true" />
								<span>{t("transactions.category.createChild")}</span>
							</CommandItem>
						)}
					</CommandGroup>
				)}
			</CommandList>
		</Command>
	);
}
