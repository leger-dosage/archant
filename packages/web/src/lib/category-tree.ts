/** The fields the tree reads; the API's category summary has more. */
type TreeCategory = { id: string; name: string; parentId: string | null };

export type CategoryBranch<Category extends TreeCategory> = {
	parent: Category;
	children: Category[];
};

const byName = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

/**
 * Parents sorted as a French reader expects, « Épargne » under E, each with
 * its children in the same order. A child whose parent is missing, from a
 * list read mid-change, stands as a parent rather than vanishing.
 */
export function categoryTree<Category extends TreeCategory>(
	categories: readonly Category[],
): CategoryBranch<Category>[] {
	const ids = new Set(categories.map((category) => category.id));
	const sorted = categories.toSorted((a, b) => byName.compare(a.name, b.name));

	return sorted
		.filter((category) => category.parentId === null || !ids.has(category.parentId))
		.map((parent) => ({
			parent,
			children: sorted.filter((category) => category.parentId === parent.id),
		}));
}
