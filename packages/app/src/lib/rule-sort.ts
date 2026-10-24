/** Sure's `rules_controller.rb#index` columns, by name first. */
export const RULE_SORTS = ["name", "updated_at"] as const;

export type RuleSort = (typeof RULE_SORTS)[number];

export const isRuleSort = (value: string): value is RuleSort =>
	(RULE_SORTS as readonly string[]).includes(value);

export const SORT_DIRECTIONS = ["asc", "desc"] as const;

export type SortDirection = (typeof SORT_DIRECTIONS)[number];

type Sortable = { name: string | null; updatedAt: number };

// Case and accents folded and digits read as text, as PostgreSQL's collation orders Sure's names.
const byName = new Intl.Collator("fr", { sensitivity: "base" });

/**
 * The rules as the list shows them, by name or by last update, as Sure's
 * `order(sort_by => direction)`. An unnamed rule comes after the named ones
 * ascending and before them descending, as PostgreSQL places `NULL`; ties
 * keep the order given, the creation order.
 */
export function sortRules<Rule extends Sortable>(
	rules: readonly Rule[],
	sortBy: RuleSort,
	direction: SortDirection,
): Rule[] {
	const sign = direction === "asc" ? 1 : -1;

	return rules.toSorted((a, b) => {
		if (sortBy === "updated_at") {
			return sign * (a.updatedAt - b.updatedAt);
		}

		if (a.name === null || b.name === null) {
			return sign * (Number(a.name === null) - Number(b.name === null));
		}

		return sign * byName.compare(a.name, b.name);
	});
}
