import type { CashFlowBreakdown, CashFlowLine, MonthBreakdown } from "../cash-flow.ts";
import type { IsoMonth } from "../dates.ts";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";

/** What a month's cash-flow breakdown (AD-9) says a budget compares with. */
export type BudgetActuals = { spending: MinorUnits; income: MinorUnits };

/** A slice of the budget's donut: a top-level expense line that spent. */
export type SpendingSegment = Pick<CashFlowLine, "categoryId" | "name" | "color" | "icon"> & {
	/** Positive. */
	spent: MinorUnits;
};

/**
 * What a line spent: its outflow net of refunds, floored at zero, as Sure's
 * `budget_category_actual_spending`. A category refunded beyond what it spent
 * spends nothing rather than lowering the others.
 */
const spentOn = (line: CashFlowLine): MinorUnits =>
	toMinorUnits(line.amount < 0 ? Math.abs(line.amount) : 0);

/**
 * The month's spending and income. Spending adds what each top-level expense
 * category spent, and « Sans catégorie »'s outflow; income is the income
 * side's signed total, never below zero.
 */
export function actualsOf(breakdown: Pick<CashFlowBreakdown, "income" | "lines">): BudgetActuals {
	return {
		spending: toMinorUnits(breakdown.lines.expense.reduce((sum, line) => sum + spentOn(line), 0)),
		income: toMinorUnits(Math.max(breakdown.income, 0)),
	};
}

/** The expense lines that spent, largest first: the donut's segments. */
export function spendingSegments(lines: readonly CashFlowLine[]): SpendingSegment[] {
	return (
		lines
			.map((line) => ({
				categoryId: line.categoryId,
				name: line.name,
				color: line.color,
				icon: line.icon,
				spent: spentOn(line),
			}))
			.filter((segment) => segment.spent > 0)
			// Stable: lines of the same size keep the breakdown's order.
			.toSorted((a, b) => b.spent - a.spent)
	);
}

/** The median of minor-unit amounts, rounded to the minor unit; `null` for none. */
export function medianOf(values: readonly MinorUnits[]): MinorUnits | null {
	if (values.length === 0) {
		return null;
	}

	const sorted = values.toSorted((a, b) => a - b);
	// The middle value of an odd count, the two middle values of an even one.
	const middle = sorted.slice((sorted.length - 1) >> 1, (sorted.length >> 1) + 1);

	return toMinorUnits(Math.round(middle.reduce((sum, value) => sum + value, 0) / middle.length));
}

/**
 * Sure's `estimated_spending` and `estimated_income`: the median of each
 * figure over the months before both `shown` and `current`. Unlike Sure, the
 * current month never counts, since half a month drags the median down. A
 * month enters a side's median only when its breakdown has a line on that
 * side, so the months before the first counted line never do.
 */
export function suggestions(
	history: readonly MonthBreakdown[],
	shown: IsoMonth,
	current: IsoMonth,
): { spending: MinorUnits | null; income: MinorUnits | null } {
	const before = shown < current ? shown : current;
	const earlier = history.filter((item) => item.month < before);

	return {
		spending: medianOf(
			earlier
				.filter((item) => item.lines.expense.length > 0)
				.map((item) => actualsOf(item).spending),
		),
		income: medianOf(
			earlier.filter((item) => item.lines.income.length > 0).map((item) => actualsOf(item).income),
		),
	};
}
