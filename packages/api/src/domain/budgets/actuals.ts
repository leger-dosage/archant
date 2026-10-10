import type { CashFlowBreakdown, CashFlowLine } from "../cash-flow.ts";

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
