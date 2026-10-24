/**
 * What a category may look like. Names only, no components: the API validates
 * an icon without depending on `lucide-react`, and the interface maps each
 * name to its component (packages/app/src/lib/category-icons.ts).
 */

export const CATEGORY_NAME_MAX_LENGTH = 60;

/**
 * Sure's `Category::COLORS`, which its goals share as `Goal::COLORS`. The
 * form offers them and a custom colour; existing rows keep theirs: see
 * `CATEGORY_COLOR_PATTERN`.
 */
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

/**
 * Any `#rrggbb`, not only one of the ten, as Sure's `validates :color,
 * format:`: the defaults carry Sure's own colours, the form takes a custom
 * one, and editing must not force the user to recolour.
 */
export const CATEGORY_COLOR_PATTERN = /^#[0-9a-f]{6}$/u;

/** One of the ten at random, as Sure's `COLORS.sample` for a new category or goal. */
export function sampleCategoryColor(random: () => number = Math.random): string {
	return CATEGORY_COLORS[Math.floor(random() * CATEGORY_COLORS.length)] ?? CATEGORY_COLORS[0];
}

/**
 * Sure's `Category.icon_codes`, in its order, which its goals share as
 * `Goal::ICONS`. `train-front` comes last: Archant offered it before
 * adopting Sure's list, and a category or a goal that has it keeps it.
 */
export const CATEGORY_ICONS = [
	"ambulance",
	"apple",
	"award",
	"baby",
	"badge-dollar-sign",
	"banknote",
	"barcode",
	"bar-chart-3",
	"bath",
	"battery",
	"bed-single",
	"beer",
	"bike",
	"bluetooth",
	"bone",
	"book",
	"book-open",
	"briefcase",
	"building",
	"bus",
	"cake",
	"calculator",
	"calendar-heart",
	"calendar-range",
	"camera",
	"car",
	"cat",
	"chart-line",
	"circle-dollar-sign",
	"circle-parking",
	"coffee",
	"coins",
	"compass",
	"cookie",
	"cooking-pot",
	"credit-card",
	"dices",
	"dog",
	"drama",
	"drill",
	"droplet",
	"drum",
	"dumbbell",
	"film",
	"flame",
	"flower",
	"flower-2",
	"fuel",
	"gamepad-2",
	"gem",
	"gift",
	"glasses",
	"globe",
	"graduation-cap",
	"hammer",
	"hand-heart",
	"hand-helping",
	"heart-handshake",
	"handshake",
	"headphones",
	"heart",
	"heart-pulse",
	"home",
	"hotel",
	"house",
	"ice-cream-cone",
	"key",
	"landmark",
	"laptop",
	"leaf",
	"lightbulb",
	"luggage",
	"mail",
	"map-pin",
	"martini",
	"mic",
	"monitor",
	"moon",
	"music",
	"package",
	"palette",
	"party-popper",
	"paw-print",
	"pen",
	"pencil",
	"percent",
	"phone",
	"pie-chart",
	"piggy-bank",
	"pill",
	"pizza",
	"plane",
	"plug",
	"popcorn",
	"power",
	"printer",
	"puzzle",
	"receipt",
	"receipt-text",
	"ribbon",
	"scale",
	"scissors",
	"settings",
	"shield",
	"shield-plus",
	"shirt",
	"shopping-bag",
	"shopping-basket",
	"shopping-cart",
	"smartphone",
	"sparkles",
	"sprout",
	"stethoscope",
	"store",
	"sun",
	"tablet-smartphone",
	"tag",
	"target",
	"tent",
	"thermometer",
	"ticket",
	"train",
	"trees",
	"tree-palm",
	"trending-up",
	"trophy",
	"truck",
	"tv",
	"umbrella",
	"undo-2",
	"unplug",
	"users",
	"utensils",
	"video",
	"wallet",
	"wallet-cards",
	"waves",
	"wifi",
	"wine",
	"wrench",
	"zap",
	"train-front",
] as const;

export type CategoryIcon = (typeof CATEGORY_ICONS)[number];

/** A category as the form or a picker creates it, before the API checks it. */
export type CategoryPreset = {
	name: string;
	color: string;
	icon: CategoryIcon;
	parentId: string | null;
};

/**
 * What a new category starts from, in the form, when a picker creates one by
 * name and when an assistant creates one: a top-level category, one of the
 * ten colours at random as Sure's `COLORS.sample`, a plain icon. Neither a picker nor an assistant has room for the
 * rest, which « Réglages › Catégories » edits later.
 */
export function newCategory(name = ""): CategoryPreset {
	return { name, color: sampleCategoryColor(), icon: "tag", parentId: null };
}
