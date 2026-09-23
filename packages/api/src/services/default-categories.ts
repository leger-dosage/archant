import type { CategoryIcon } from "@archant/data/category-presets";
import type { CategoryKind } from "@archant/data/schema/categories";

export type DefaultCategory = {
	name: string;
	kind: CategoryKind;
	color: string;
	icon: CategoryIcon;
};

/**
 * The set a fresh instance starts with, adapted from Sure's names, colours
 * and icons. All top-level, as in Sure: the user makes the sub-categories.
 * French strings stored as data, not translation keys: once seeded they are
 * the user's own, to rename like any other.
 */
export const DEFAULT_CATEGORIES: readonly DefaultCategory[] = [
	{ name: "Revenus", kind: "income", color: "#22c55e", icon: "circle-dollar-sign" },
	{ name: "Courses", kind: "expense", color: "#407706", icon: "shopping-bag" },
	{ name: "Restaurants", kind: "expense", color: "#f97316", icon: "utensils" },
	{ name: "Transports", kind: "expense", color: "#0ea5e9", icon: "bus" },
	{ name: "Logement", kind: "expense", color: "#b45309", icon: "house" },
	{ name: "Énergie et eau", kind: "expense", color: "#eab308", icon: "lightbulb" },
	{ name: "Abonnements", kind: "expense", color: "#6366f1", icon: "wifi" },
	{ name: "Assurances", kind: "expense", color: "#0284c7", icon: "shield" },
	{ name: "Santé", kind: "expense", color: "#4da568", icon: "pill" },
	{ name: "Impôts et taxes", kind: "expense", color: "#dc2626", icon: "landmark" },
	{ name: "Frais bancaires", kind: "expense", color: "#6b7280", icon: "receipt" },
	{ name: "Loisirs", kind: "expense", color: "#a855f7", icon: "drama" },
	{ name: "Voyages", kind: "expense", color: "#2563eb", icon: "plane" },
	{ name: "Cadeaux et dons", kind: "expense", color: "#61c9ea", icon: "hand-helping" },
	{ name: "Épargne et placements", kind: "expense", color: "#059669", icon: "piggy-bank" },
];
