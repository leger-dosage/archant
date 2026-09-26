import type { CreateCategoryInput } from "@archant/api/schemas/categories";
import { CATEGORY_COLORS } from "@archant/data/category-presets";

/**
 * What a new category starts from, in the form and when a picker creates one
 * by name: a top-level expense, the first swatch, a plain icon. A picker has
 * no room for the rest, which « Réglages › Catégories » edits later.
 */
export function newCategory(name = ""): CreateCategoryInput {
	return { name, kind: "expense", color: CATEGORY_COLORS[0], icon: "tag", parentId: null };
}
