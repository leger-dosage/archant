import type { CashFlowCategory } from "../cash-flow.ts";
import type { BudgetRow } from "./categories.ts";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";

import { movableOf, parentAfterChildSave } from "./categories.ts";

/** A category as a move or a copy places it: its id and its parent's. */
export type BudgetedCategory = Pick<CashFlowCategory, "id" | "parentId">;

/** The `InvalidMove` reasons that depend on the month's envelopes. */
type MoveRefusal =
	| "BUDGET_MOVE_SAME_CATEGORY"
	| "BUDGET_MOVE_PARENT_CHILD"
	| "BUDGET_MOVE_INSUFFICIENT_FUNDS";

const zero = toMinorUnits(0);

const sumOf = (amounts: readonly MinorUnits[]): MinorUnits =>
	toMinorUnits(amounts.reduce((sum, amount) => sum + amount, 0));

/**
 * Sure's `BudgetCategory.move_allocation!`: `amount` leaves `from` for `to`,
 * each side changing as a save of its own amount does, the source first, so
 * a subcategory's parent is re-summed and a shared child that receives is
 * ring-fenced. `categories` are every category, `amounts` the month's
 * stored ones. Answers the amounts that change, or why the move is refused:
 * to itself, between a parent and its own child, or beyond what `from` can give.
 */
export function moveAllocation(input: {
	categories: readonly BudgetedCategory[];
	amounts: ReadonlyMap<string, MinorUnits>;
	from: BudgetedCategory;
	to: BudgetedCategory;
	amount: MinorUnits;
}): { changes: Map<string, MinorUnits> } | { refusal: MoveRefusal } {
	const { categories, from, to, amount } = input;
	const changes = new Map<string, MinorUnits>();
	const amountOf = (id: string) => changes.get(id) ?? input.amounts.get(id) ?? zero;
	const childrenOf = (parentId: string, except?: string) =>
		sumOf(
			categories
				.filter((category) => category.parentId === parentId && category.id !== except)
				.map((category) => amountOf(category.id)),
		);

	if (from.id === to.id) {
		return { refusal: "BUDGET_MOVE_SAME_CATEGORY" };
	}

	if (from.parentId === to.id || to.parentId === from.id) {
		return { refusal: "BUDGET_MOVE_PARENT_CHILD" };
	}

	const movable = movableOf({
		amount: amountOf(from.id),
		parentId: from.parentId,
		children: childrenOf(from.id),
	});

	if (amount > movable) {
		return { refusal: "BUDGET_MOVE_INSUFFICIENT_FUNDS" };
	}

	const save = (category: BudgetedCategory, next: MinorUnits) => {
		const previousChild = amountOf(category.id);

		changes.set(category.id, next);

		if (category.parentId !== null) {
			changes.set(
				category.parentId,
				parentAfterChildSave({
					parent: amountOf(category.parentId),
					siblings: childrenOf(category.parentId, category.id),
					previousChild,
					child: next,
				}),
			);
		}
	};

	save(from, toMinorUnits(amountOf(from.id) - amount));
	save(to, toMinorUnits(amountOf(to.id) + amount));

	return { changes };
}

/** Sure copies the stored amount and rollover choice. The chain derives the carry again. */
export function copiedRows(input: {
	categories: readonly Pick<BudgetedCategory, "id">[];
	source: ReadonlyMap<string, BudgetRow>;
}): Map<string, BudgetRow> {
	const { categories } = input;
	const copied = new Map<string, BudgetRow>();

	for (const category of categories) {
		const row = input.source.get(category.id);

		if (row !== undefined) {
			copied.set(category.id, row);
		}
	}

	return copied;
}
