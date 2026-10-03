import type { IsoMonth } from "../dates.ts";
import type { BudgetRow, TreeCategory } from "./categories.ts";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";

/** A month set up: its currency, its rows by category, and what each category spent. */
export type RolloverMonth = {
	month: IsoMonth;
	currency: string;
	rows: ReadonlyMap<string, BudgetRow>;
	/** As `spentByCategory` counts it: a parent's with its children's; absent is 0. */
	spending: ReadonlyMap<string, MinorUnits>;
};

const zero = toMinorUnits(0);

const sumOf = (amounts: readonly MinorUnits[]): MinorUnits =>
	toMinorUnits(amounts.reduce((sum, amount) => sum + amount, 0));

/**
 * Sure's `Budget::RolloverCalculator`, in one forward pass over the months
 * set up, oldest first: a month never set up is not in `months`, so the carry
 * crosses it untouched. Answers what each row of each month received from the
 * month set up before it, Sure's `rolled_over_amount`, an entry for each row.
 *
 * A row receives the previous month's carry when its rollover is on, and
 * carries `max(0, amount + received − spent)` when it is on, nothing when it
 * is off, so a month switched off neither receives nor gives. A parent leaves
 * out its ring-fenced children's amounts and spending, which carry their own.
 * A shared subcategory, at 0, has nothing of its own to carry. A category
 * deleted, or no longer an expense category, is off. A month in another
 * currency than the one before starts from nothing: the amounts are not in
 * the same unit. Today's category tree applies to every month.
 */
export function rolloverChain(input: {
	categories: readonly TreeCategory[];
	months: readonly RolloverMonth[];
}): Map<IsoMonth, Map<string, MinorUnits>> {
	const expense = new Map(
		input.categories
			.filter((category) => category.kind === "expense")
			.map((category) => [category.id, category]),
	);
	const childrenOf = (id: string) =>
		[...expense.values()].filter((category) => category.parentId === id);
	const chain = new Map<IsoMonth, Map<string, MinorUnits>>();
	let previous: { currency: string; carry: ReadonlyMap<string, MinorUnits> } | null = null;

	for (const month of input.months.toSorted((a, b) => a.month.localeCompare(b.month))) {
		const amountOf = (id: string) => month.rows.get(id)?.budgetedSpending ?? zero;
		const spentOn = (id: string) => month.spending.get(id) ?? zero;
		const incoming: ReadonlyMap<string, MinorUnits> =
			previous?.currency === month.currency ? previous.carry : new Map();
		const received = new Map<string, MinorUnits>();
		const carry = new Map<string, MinorUnits>();

		for (const [id, row] of month.rows) {
			const category = expense.get(id);

			if (
				category === undefined ||
				!row.rolloverEnabled ||
				// Shared: it spends its parent's money, which the parent carries.
				(category.parentId !== null && row.budgetedSpending === 0)
			) {
				received.set(id, zero);
				continue;
			}

			const carriedIn = incoming.get(id) ?? zero;
			const ringFenced =
				category.parentId === null ? childrenOf(id).filter((child) => amountOf(child.id) > 0) : [];
			const left =
				row.budgetedSpending +
				carriedIn -
				spentOn(id) -
				sumOf(ringFenced.map((child) => amountOf(child.id))) +
				sumOf(ringFenced.map((child) => spentOn(child.id)));

			received.set(id, carriedIn);
			// Only a surplus carries: an overspent month stops where it happened.
			carry.set(id, toMinorUnits(Math.max(left, 0)));
		}

		chain.set(month.month, received);
		previous = { currency: month.currency, carry };
	}

	return chain;
}
