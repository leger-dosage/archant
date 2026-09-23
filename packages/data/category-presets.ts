/**
 * What a category may look like. Names only, no components: the API validates
 * an icon without depending on `lucide-react`, and the interface maps each
 * name to its component (packages/web/src/lib/category-icons.ts).
 */

export const CATEGORY_NAME_MAX_LENGTH = 60;

/** Sure's ten swatches, the only colours the form offers. */
export const CATEGORY_COLORS = [
	"#e99537",
	"#4da568",
	"#6471eb",
	"#db5a54",
	"#df4e92",
	"#c44fe9",
	"#eb5429",
	"#61c9ea",
	"#805dee",
	"#6ad28a",
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
