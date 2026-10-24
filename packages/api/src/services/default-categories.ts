import type { CategoryIcon } from "@archant/data/category-presets";

export type DefaultCategory = {
	name: string;
	color: string;
	icon: CategoryIcon;
};

/**
 * Sure's `Category#default_categories`, in its order, with its colours and
 * icons. All top-level, as in Sure: the user makes the sub-categories. Names
 * in the French a French user expects; the seven Archant lacked before Story
 * 32.2 take Sure's `fr.yml` names. Stored as data, not translation keys: once
 * seeded they are the user's own, to rename like any other.
 */
export const DEFAULT_CATEGORIES: readonly DefaultCategory[] = [
	{ name: "Revenus", color: "#22c55e", icon: "circle-dollar-sign" },
	{ name: "Restaurants", color: "#f97316", icon: "utensils" },
	{ name: "Courses", color: "#407706", icon: "shopping-bag" },
	{ name: "Achats", color: "#3b82f6", icon: "shopping-cart" },
	{ name: "Transports", color: "#0ea5e9", icon: "bus" },
	{ name: "Voyages", color: "#2563eb", icon: "plane" },
	{ name: "Loisirs", color: "#a855f7", icon: "drama" },
	{ name: "Santé", color: "#4da568", icon: "pill" },
	{ name: "Soins personnels", color: "#14b8a6", icon: "scissors" },
	{ name: "Amélioration de l'habitat", color: "#d97706", icon: "hammer" },
	{ name: "Logement", color: "#b45309", icon: "home" },
	{ name: "Énergie et eau", color: "#eab308", icon: "lightbulb" },
	{ name: "Abonnements", color: "#6366f1", icon: "wifi" },
	{ name: "Assurances", color: "#0284c7", icon: "shield" },
	{ name: "Sports et remise en forme", color: "#10b981", icon: "dumbbell" },
	{ name: "Cadeaux et dons", color: "#61c9ea", icon: "hand-helping" },
	{ name: "Impôts et taxes", color: "#dc2626", icon: "landmark" },
	{ name: "Paiements du prêt", color: "#e11d48", icon: "credit-card" },
	{ name: "Prestations", color: "#7c3aed", icon: "briefcase" },
	{ name: "Frais bancaires", color: "#6b7280", icon: "receipt" },
	{ name: "Épargne et placements", color: "#059669", icon: "piggy-bank" },
	{ name: "Contributions aux investissements", color: "#0d9488", icon: "trending-up" },
];
