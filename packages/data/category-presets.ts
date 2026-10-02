/**
 * What a category may look like. Names only, no components: the API validates
 * an icon without depending on `lucide-react`, and the interface maps each
 * name to its component (packages/app/src/lib/category-icons.ts).
 */

export const CATEGORY_NAME_MAX_LENGTH = 60;

/**
 * Groups the display only (AD-9): a category total is the signed sum of its
 * transactions, and nothing flips a sign on the kind.
 */
export const CATEGORY_KINDS = ["income", "expense"] as const;

export type CategoryKind = (typeof CATEGORY_KINDS)[number];

/**
 * DESIGN.md's ten swatches, Linear's register, the only colours the form
 * offers. Existing categories keep theirs: see `CATEGORY_COLOR_PATTERN`.
 */
export const CATEGORY_COLORS = [
	"#fc7840",
	"#f0bf00",
	"#4ea7fc",
	"#00b8cc",
	"#27a644",
	"#5e6ad2",
	"#eb5757",
	"#9d6fe8",
	"#e2609c",
	"#c95fd8",
] as const;

export type CategoryColor = (typeof CATEGORY_COLORS)[number];

/**
 * Any `#rrggbb`, not only a swatch: the defaults carry Sure's own colours,
 * and editing one must not force the user to recolour it.
 */
export const CATEGORY_COLOR_PATTERN = /^#[0-9a-f]{6}$/u;

/** Lucide names: the ones the defaults use, then a choice for the user's own. */
export const CATEGORY_ICONS = [
	"circle-dollar-sign",
	"shopping-bag",
	"utensils",
	"bus",
	"house",
	"lightbulb",
	"wifi",
	"shield",
	"pill",
	"landmark",
	"receipt",
	"drama",
	"plane",
	"hand-helping",
	"piggy-bank",
	"tag",
	"shopping-cart",
	"car",
	"fuel",
	"train-front",
	"bike",
	"baby",
	"dog",
	"graduation-cap",
	"dumbbell",
	"shirt",
	"gift",
	"heart",
	"briefcase",
	"wrench",
	"smartphone",
	"tv",
	"music",
	"book-open",
	"coffee",
	"banknote",
	"coins",
	"credit-card",
] as const;

export type CategoryIcon = (typeof CATEGORY_ICONS)[number];

/** A category as the form or a picker creates it, before the API checks it. */
export type CategoryPreset = {
	name: string;
	kind: CategoryKind;
	color: CategoryColor;
	icon: CategoryIcon;
	parentId: string | null;
};

/**
 * What a new category starts from, in the form, when a picker creates one by
 * name and when an assistant creates one: a top-level expense, the first
 * swatch, a plain icon. Neither a picker nor an assistant has room for the
 * rest, which « Réglages › Catégories » edits later.
 */
export function newCategory(name = ""): CategoryPreset {
	return { name, kind: "expense", color: CATEGORY_COLORS[0], icon: "tag", parentId: null };
}
