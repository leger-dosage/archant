import type { CashFlowCategory } from "../cash-flow.ts";
import type { BudgetRow } from "./categories.ts";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";

import { movableOf, parentAfterChildSave, parentAfterOwnSave } from "./categories.ts";

/** A category as a move or a copy places it: its id and its parent's. */
export type BudgetedCategory = Pick<CashFlowCategory, "id" | "parentId">;

/** Sure's `InvalidMove` reasons, as the field of a `VALIDATION_ERROR` each belongs to. */
type MoveRefusal =
	| { path: "amount"; code: "insufficient_funds" }
	| { path: "toCategoryId"; code: "same_category" | "parent_child" };

const zero = toMinorUnits(0);

const sumOf = (amounts: readonly MinorUnits[]): MinorUnits =>
	toMinorUnits(amounts.reduce((sum, amount) => sum + amount, 0));

/**
 * Sure's `BudgetCategory.move_allocation!`: `amount` leaves `from` for `to`,
 * each side changing as a save of its own amount does, the source first, so
 * a subcategory's parent is re-summed and a shared child that receives is
 * ring-fenced. `categories` are the expense categories, `amounts` the month's
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
		return { refusal: { path: "toCategoryId", code: "same_category" } };
	}

	if (from.parentId === to.id || to.parentId === from.id) {
		return { refusal: { path: "toCategoryId", code: "parent_child" } };
	}

	const movable = movableOf({
		amount: amountOf(from.id),
		parentId: from.parentId,
		children: childrenOf(from.id),
	});

	if (amount > movable) {
		return { refusal: { path: "amount", code: "insufficient_funds" } };
	}

	const save = (category: BudgetedCategory, next: MinorUnits) => {
		if (category.parentId === null) {
			changes.set(
				category.id,
				parentAfterOwnSave({ typed: next, children: childrenOf(category.id) }),
			);

			return;
		}

		const previousChild = amountOf(category.id);

		changes.set(category.id, next);
		changes.set(
			category.parentId,
			parentAfterChildSave({
				parent: amountOf(category.parentId),
				siblings: childrenOf(category.parentId, category.id),
				previousChild,
				child: next,
			}),
		);
	};

	save(from, toMinorUnits(amountOf(from.id) - amount));
	save(to, toMinorUnits(amountOf(to.id) + amount));

	return { changes };
}

/**
 * Sure's `Budget#copy_from!`, on the categories of today: each row of a
 * category that is still an expense category, its amount beside its rollover
 * switch, a deleted one's being gone with it. What came in is never copied:
 * the chain computes it. A parent is then lifted to its children's amounts,
 * as its own save would be, so a child re-parented since cannot leave it
 * below them; a parent lifted without a row of its own has rollover off.
 */
export function copiedRows(input: {
	categories: readonly (BudgetedCategory & Pick<CashFlowCategory, "kind">)[];
	source: ReadonlyMap<string, BudgetRow>;
}): Map<string, BudgetRow> {
	const expense = input.categories.filter((category) => category.kind === "expense");
	const copied = new Map<string, BudgetRow>();

	for (const category of expense) {
		const row = input.source.get(category.id);

		if (row !== undefined) {
			copied.set(category.id, row);
		}
	}

	for (const parent of expense.filter((category) => category.parentId === null)) {
		const children = sumOf(
			expense
				.filter((category) => category.parentId === parent.id)
				.map((category) => copied.get(category.id)?.budgetedSpending ?? zero),
		);
		const own = copied.get(parent.id);

		if (own !== undefined || children > 0) {
			copied.set(parent.id, {
				budgetedSpending: parentAfterOwnSave({ typed: own?.budgetedSpending ?? zero, children }),
				rolloverEnabled: own?.rolloverEnabled ?? false,
			});
		}
	}

	return copied;
}
