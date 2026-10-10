import type { CashFlowCategory, CashFlowRow } from "../cash-flow.ts";
import type { IsoMonth } from "../dates.ts";

import type { CategoryIcon } from "@archant/data/category-presets";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";

import { medianOf } from "./actuals.ts";

/** Sure's three pills: over budget, near the limit from 90 %, on track. */
type BudgetStatus = "over" | "near" | "onTrack";

/** Where a card shows: Sure's « Over Budget » or « On Track » section. */
type BudgetSection = "over" | "onTrack";

/** What a card, a field of the categories step and the sheet read of an envelope. */
type Envelope = {
	/**
	 * The stored amount, 0 without a row. A parent's is its total: its
	 * ring-fenced children's amounts plus its own reserve.
	 */
	budgetedSpending: MinorUnits;
	/** Sure's `budgeted?`: money in this envelope, the parent's for a shared child. */
	budgeted: boolean;
	/** The month's outflow net of refunds, floored at zero; a parent's includes its children's. */
	spent: MinorUnits;
	/** Sure's `available_to_spend`: negative once over. */
	available: MinorUnits;
	/** Sure's `percent_of_budget_spent`, unbounded: a card's bar fills to 100. */
	percentSpent: number;
	status: BudgetStatus;
	/** `null` when hidden: neither budgeted nor spending, or a shared child yet to spend. */
	section: BudgetSection | null;
	/** Over the complete earlier months in which it has a counted row; `null` without one. */
	median: MinorUnits | null;
	average: MinorUnits | null;
};

/** An expense category's envelope. */
export type BudgetCategoryLine = Envelope & {
	categoryId: string;
	parentId: string | null;
	name: string;
	color: string;
	icon: CategoryIcon;
	/** A subcategory at 0: it shares its parent's amount, « Partagé ». */
	shared: boolean;
	/** What a move can take from it, as Sure's `movable_from`: see `movableOf`. */
	movable: MinorUnits;
	/** Its « Report » switch: what it leaves carries into the next month set up. */
	rolloverEnabled: boolean;
	/**
	 * Sure's `display_rolled_over_amount`, what came in from the month before:
	 * a ring-fenced child's own carry, a parent's own plus its ring-fenced
	 * children's, a shared child its parent's own. It counts in what remains,
	 * never in `budgetedSpending`, the allocation or what a move can take.
	 */
	rolledOver: MinorUnits;
};

/** « Sans catégorie »: what the total leaves unallocated, never stored. */
export type UncategorisedLine = Envelope;

/** A month's counted rows, as `cashFlowByMonth` groups them. */
export type MonthRows = { month: IsoMonth; rows: readonly CashFlowRow[] };

/** A category's stored row in a month: its amount and its « Report » switch. */
export type BudgetRow = { budgetedSpending: MinorUnits; rolloverEnabled: boolean };

/** What placing a category in today's tree reads of it. */
export type TreeCategory = Pick<CashFlowCategory, "id" | "kind" | "parentId">;

const byName = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

const spentOf = (net: MinorUnits): MinorUnits => toMinorUnits(net < 0 ? Math.abs(net) : 0);

const zero = toMinorUnits(0);

/** The mean of minor-unit amounts, rounded to the minor unit; `null` for none. */
export function averageOf(values: readonly MinorUnits[]): MinorUnits | null {
	if (values.length === 0) {
		return null;
	}

	return toMinorUnits(Math.round(values.reduce((sum, value) => sum + value, 0) / values.length));
}

const statsOf = (values: readonly MinorUnits[]) => ({
	median: medianOf(values),
	average: averageOf(values),
});

/**
 * Sure's `sync_parent_budgeted_spending!`: once a child's amount changes, its
 * parent becomes its children's amounts plus its own reserve. The reserve is
 * what the parent held beyond its children before the change, never below
 * zero, so an inconsistent parent is lifted to its children's sum.
 */
export function parentAfterChildSave(amounts: {
	parent: MinorUnits;
	/** The other children's stored amounts, summed. */
	siblings: MinorUnits;
	previousChild: MinorUnits;
	child: MinorUnits;
}): MinorUnits {
	const { parent, siblings, previousChild, child } = amounts;

	return toMinorUnits(siblings + child + Math.max(parent - siblings - previousChild, 0));
}

/**
 * A parent saved for itself: never below what its ring-fenced children hold,
 * so its amount stays their sum plus a reserve that is never negative. Sure
 * stores it as typed and lifts it at the next child's save; until then its
 * allocation undercounts, and « Valider » could pass the total.
 */
export function parentAfterOwnSave(amounts: {
	typed: MinorUnits;
	/** Its children's stored amounts, summed: a shared child's is 0. */
	children: MinorUnits;
}): MinorUnits {
	return toMinorUnits(Math.max(amounts.typed, amounts.children));
}

/**
 * Sure's `movable_from`: what a move can take from a category. A subcategory
 * gives its stored amount; a parent only what it keeps beyond its
 * ring-fenced children, never below zero, since their money is theirs.
 */
export function movableOf(amounts: {
	amount: MinorUnits;
	parentId: string | null;
	/** Its children's stored amounts, summed: a shared child's is 0. */
	children: MinorUnits;
}): MinorUnits {
	const { amount, parentId, children } = amounts;

	return parentId === null ? toMinorUnits(Math.max(amount - children, 0)) : amount;
}

/**
 * Sure's `percent_of_budget_spent`: nothing of nothing is 0, something of
 * nothing 100. A shared child's budget can be negative, read as nothing.
 */
function percentSpent(budget: MinorUnits, spent: MinorUnits): number {
	if (budget <= 0) {
		return spent > 0 ? 100 : 0;
	}

	return (spent / budget) * 100;
}

/** Sure's pill: over once `available` is negative, near the limit from 90 % spent. */
function statusOf(available: MinorUnits, percent: number): BudgetStatus {
	if (available < 0) {
		return "over";
	}

	return percent >= 90 ? "near" : "onTrack";
}

/**
 * The figures every envelope derives the same way, as Sure's `budget_category.rb`:
 * its pill, from what it spent of `budget`; and its section, as Sure's `budgets_helper.rb`.
 * « Dépassées » holds what is over, or unbudgeted and spending
 * (`any_over_budget?`); « Dans les clous » what is budgeted and not over
 * (`visible_on_track?`), a shared child only once it spent.
 */
function measured(envelope: {
	/** What `percentSpent` measures against. */
	budget: MinorUnits;
	budgeted: boolean;
	spent: MinorUnits;
	available: MinorUnits;
	shared: boolean;
}) {
	const { budget, budgeted, spent, available, shared } = envelope;
	const percent = percentSpent(budget, spent);
	const over = (!budgeted && spent > 0) || (budgeted && available < 0);
	let section: BudgetSection | null = null;

	if (over) {
		section = "over";
	} else if (budgeted && (!shared || spent > 0)) {
		section = "onTrack";
	}

	return {
		budgeted,
		spent,
		available,
		percentSpent: percent,
		status: statusOf(available, percent),
		section,
	};
}

/**
 * Each category's signed net over `rows`, a parent's with its children's,
 * whatever its kind, and « Sans catégorie »'s, as Sure's
 * `budget_category_actual_spending` nets a category's expense and refunds,
 * its `:uncategorized` key included. A row in an unknown category is
 * uncategorised, as `grossCashFlow` counts it. `uncategorised` stays `null`
 * until an uncategorised outflow is counted, so a month of uncategorised
 * income alone enters no median.
 */
function netsOf(rows: readonly CashFlowRow[], byId: ReadonlyMap<string, TreeCategory>) {
	const nets = new Map<string, MinorUnits>();
	let uncategorisedNet = 0;
	let spentUncategorised = false;

	for (const row of rows) {
		const own = row.categoryId === null ? undefined : byId.get(row.categoryId);

		if (own === undefined) {
			uncategorisedNet += row.amount;
			spentUncategorised ||= row.amount < 0;
		} else {
			for (const id of own.parentId === null ? [own.id] : [own.id, own.parentId]) {
				nets.set(id, toMinorUnits((nets.get(id) ?? 0) + row.amount));
			}
		}
	}

	return { nets, uncategorised: spentUncategorised ? toMinorUnits(uncategorisedNet) : null };
}

/**
 * What each category spent over `rows`, a parent with its children,
 * floored at zero, as `budgetCategories` counts it; a category that counted
 * no row has no entry.
 */
export function spentByCategory(
	rows: readonly CashFlowRow[],
	categories: readonly TreeCategory[],
): Map<string, MinorUnits> {
	const { nets } = netsOf(rows, new Map(categories.map((category) => [category.id, category])));

	return new Map([...nets].map(([id, net]) => [id, spentOf(net)]));
}

/**
 * What each envelope spent in each earlier month in which it has a counted
 * row, a parent's months including its children's: the values its median and
 * average take. « Sans catégorie » counts the months with an outflow.
 */
function historyOf(history: readonly MonthRows[], byId: ReadonlyMap<string, TreeCategory>) {
	const perCategory = new Map<string, MinorUnits[]>();
	const uncategorised: MinorUnits[] = [];

	for (const { rows } of history) {
		const { nets, uncategorised: outflow } = netsOf(rows, byId);

		for (const [id, net] of nets) {
			perCategory.set(id, [...(perCategory.get(id) ?? []), spentOf(net)]);
		}

		if (outflow !== null) {
			uncategorised.push(spentOf(outflow));
		}
	}

	return { perCategory, uncategorised };
}

const sumOf = (amounts: readonly MinorUnits[]): MinorUnits =>
	toMinorUnits(amounts.reduce((sum, amount) => sum + amount, 0));

/**
 * A month's envelopes, as Sure's `budget_category.rb` computes them: every
 * expense category, parents by name with their children by name under them,
 * and « Sans catégorie », which budgets what the total leaves unallocated.
 * `amounts` holds the stored amounts by category; a category without one has
 * 0. `rollover` holds each row's switch and what `rolloverChain` carried into
 * it. `history` is the counted rows of the months before both `shown` and
 * `current`, as 17.1's suggestions take them.
 */
export function budgetCategories(input: {
	categories: readonly CashFlowCategory[];
	amounts: ReadonlyMap<string, MinorUnits>;
	rollover: ReadonlyMap<string, { enabled: boolean; carried: MinorUnits }>;
	rows: readonly CashFlowRow[];
	history: readonly MonthRows[];
	shown: IsoMonth;
	current: IsoMonth;
	budgetedSpending: MinorUnits | null;
}): { categories: BudgetCategoryLine[]; uncategorised: UncategorisedLine; allocated: MinorUnits } {
	const { amounts, shown, current } = input;
	const byId = new Map(input.categories.map((category) => [category.id, category]));
	const expense = input.categories
		.filter((category) => category.kind === "expense")
		.toSorted((a, b) => byName.compare(a.name, b.name));
	const parents = expense.filter((category) => category.parentId === null);
	const childrenOf = (id: string) => expense.filter((category) => category.parentId === id);
	const amountOf = (id: string) => amounts.get(id) ?? zero;
	const carriedOf = (id: string) => input.rollover.get(id)?.carried ?? zero;
	const ringFencedOf = (parentId: string) =>
		childrenOf(parentId).filter((child) => amountOf(child.id) > 0);
	const { nets, uncategorised: uncategorisedNet } = netsOf(input.rows, byId);
	const spentOn = (id: string) => spentOf(nets.get(id) ?? zero);
	const before = shown < current ? shown : current;
	const past = historyOf(
		input.history.filter((item) => item.month < before),
		byId,
	);

	/**
	 * Sure's shared child: only what the parent keeps beyond its ring-fenced
	 * children, with the parent's own carry, against what the parent spent
	 * beyond theirs, never below zero.
	 */
	const sharedOf = (parentId: string, spent: MinorUnits) => {
		const parent = toMinorUnits(amountOf(parentId) + carriedOf(parentId));
		const ringFenced = ringFencedOf(parentId);
		const budget = toMinorUnits(parent - sumOf(ringFenced.map((child) => amountOf(child.id))));
		const poolSpent = spentOn(parentId) - sumOf(ringFenced.map((child) => spentOn(child.id)));

		return measured({
			budget,
			budgeted: parent > 0,
			spent,
			available: toMinorUnits(Math.max(budget - poolSpent, 0)),
			shared: true,
		});
	};

	/** Sure's `display_rolled_over_amount`, a parent's with its ring-fenced children's. */
	const rolledOverOf = (category: CashFlowCategory, shared: boolean): MinorUnits => {
		if (category.parentId !== null) {
			return carriedOf(shared ? category.parentId : category.id);
		}

		return sumOf(
			[category.id, ...ringFencedOf(category.id).map((child) => child.id)].map(carriedOf),
		);
	};

	const lineOf = (category: CashFlowCategory): BudgetCategoryLine => {
		const budgetedSpending = amountOf(category.id);
		const spent = spentOn(category.id);
		const shared = category.parentId !== null && budgetedSpending === 0;
		const rolledOver = rolledOverOf(category, shared);
		const budget = toMinorUnits(budgetedSpending + rolledOver);

		return {
			categoryId: category.id,
			parentId: category.parentId,
			name: category.name,
			color: category.color,
			icon: category.icon,
			budgetedSpending,
			shared,
			movable: movableOf({
				amount: budgetedSpending,
				parentId: category.parentId,
				children: sumOf(childrenOf(category.id).map((child) => amountOf(child.id))),
			}),
			rolloverEnabled: input.rollover.get(category.id)?.enabled ?? false,
			rolledOver,
			...statsOf(past.perCategory.get(category.id) ?? []),
			...(category.parentId !== null && shared
				? sharedOf(category.parentId, spent)
				: measured({
						budget,
						budgeted: budget > 0,
						spent,
						available: toMinorUnits(budget - spent),
						shared,
					})),
		};
	};

	const allocated = sumOf(parents.map((parent) => amountOf(parent.id)));
	const left = toMinorUnits(Math.max((input.budgetedSpending ?? 0) - allocated, 0));
	const uncategorisedSpent = spentOf(uncategorisedNet ?? zero);
	const uncategorised = measured({
		budget: left,
		budgeted: left > 0,
		spent: uncategorisedSpent,
		available: toMinorUnits(left - uncategorisedSpent),
		shared: false,
	});

	return {
		categories: parents.flatMap((parent) => [lineOf(parent), ...childrenOf(parent.id).map(lineOf)]),
		uncategorised: {
			budgetedSpending: left,
			...uncategorised,
			// Sure lists « Sans catégorie » on track only beside a category of its own.
			section:
				uncategorised.section === "onTrack" && expense.length === 0 ? null : uncategorised.section,
			...statsOf(past.uncategorised),
		},
		allocated,
	};
}
