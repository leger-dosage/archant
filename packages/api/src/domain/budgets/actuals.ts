import type { CashFlowBreakdown, CashFlowLine, MonthBreakdown } from "../cash-flow.ts";
import type { IsoMonth } from "../dates.ts";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";

/** What a month's cash-flow views (AD-9) say a budget compares with. */
export type BudgetActuals = { spending: MinorUnits; income: MinorUnits };

/** A slice of the budget's donut: a top-level net expense line. */
export type SpendingSegment = Pick<CashFlowLine, "categoryId" | "name" | "color" | "icon"> & {
	/** Positive. */
	spent: MinorUnits;
};

/** What a line spent: its magnitude on the expense side, nothing on the income side. */
const spentOn = (line: CashFlowLine): MinorUnits =>
	toMinorUnits(line.amount < 0 ? Math.abs(line.amount) : 0);

/**
 * The month's spending and income, as Sure's `Budget#actual_spending` and
 * `actual_income`: spending is the net view's expense total,
 * `total_net_expense`, so a refund lowers its category and a category that
 * took in more than it spent spends nothing; income is the gross view's
 * income total, refunds included.
 */
export function actualsOf(views: {
	net: Pick<CashFlowBreakdown, "expenses">;
	gross: Pick<CashFlowBreakdown, "income">;
}): BudgetActuals {
	return {
		spending: toMinorUnits(Math.abs(views.net.expenses)),
		income: views.gross.income,
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
 * month enters a side's median only when its gross view has a line on that
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
				.filter((item) => item.gross.lines.expense.length > 0)
				.map((item) => actualsOf(item).spending),
		),
		income: medianOf(
			earlier
				.filter((item) => item.gross.lines.income.length > 0)
				.map((item) => actualsOf(item).income),
		),
	};
}
