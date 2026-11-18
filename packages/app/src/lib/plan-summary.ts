import type { BudgetCategoryData } from "@/hooks/useBudget";

import type { MinorUnits } from "@archant/data/money";

type RankedCategory = Pick<BudgetCategoryData, "parentId" | "spent" | "budgetedSpending">;

/** Sure ranks parent categories by spending, breaking ties by allocation. */
export function topBudgetCategories<Category extends RankedCategory>(
	categories: readonly Category[],
): Category[] {
	return categories
		.filter(
			({ parentId, spent, budgetedSpending }) =>
				parentId === null && (spent !== 0 || budgetedSpending !== 0),
		)
		.toSorted((a, b) => b.spent - a.spent || b.budgetedSpending - a.budgetedSpending)
		.slice(0, 4);
}

/** Count both calendar dates, regardless of any clock change between them. */
export function budgetDaysLeft(today: string, end: string): number {
	return Math.max(0, (Date.parse(end) - Date.parse(today)) / 86_400_000 + 1);
}

export function percentOf(part: MinorUnits, whole: MinorUnits): number {
	return whole > 0 ? (part / whole) * 100 : 0;
}
