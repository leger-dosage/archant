import type { CategoryIcon } from "@archant/data/category-presets";

export type DefaultCategory = {
	name: string;
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
	{ name: "Revenus", color: "#22c55e", icon: "circle-dollar-sign" },
	{ name: "Courses", color: "#407706", icon: "shopping-bag" },
	{ name: "Restaurants", color: "#f97316", icon: "utensils" },
	{ name: "Transports", color: "#0ea5e9", icon: "bus" },
	{ name: "Logement", color: "#b45309", icon: "house" },
	{ name: "Énergie et eau", color: "#eab308", icon: "lightbulb" },
	{ name: "Abonnements", color: "#6366f1", icon: "wifi" },
	{ name: "Assurances", color: "#0284c7", icon: "shield" },
	{ name: "Santé", color: "#4da568", icon: "pill" },
	{ name: "Impôts et taxes", color: "#dc2626", icon: "landmark" },
	{ name: "Frais bancaires", color: "#6b7280", icon: "receipt" },
	{ name: "Loisirs", color: "#a855f7", icon: "drama" },
	{ name: "Voyages", color: "#2563eb", icon: "plane" },
	{ name: "Cadeaux et dons", color: "#61c9ea", icon: "hand-helping" },
	{ name: "Épargne et placements", color: "#059669", icon: "piggy-bank" },
];
