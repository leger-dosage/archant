import type { IsoMonth } from "./dates.ts";

import type { CategoryIcon, CategoryKind } from "@archant/data/category-presets";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import type { TransferKind } from "@archant/data/transfer-kinds";
import { EXPENSE_TRANSFER_KINDS } from "@archant/data/transfer-kinds";

export const DIRECTIONS = ["income", "expense", "transfer"] as const;

export type Direction = (typeof DIRECTIONS)[number];

/** What `direction` reads of a transaction; anything else it carries is ignored. */
export type CashFlowTransaction = {
	/** Signed from the account's point of view: negative leaves the account. */
	amount: MinorUnits;
	transfer: { kind: TransferKind } | null;
};

const expenseKinds: ReadonlySet<TransferKind> = new Set(EXPENSE_TRANSFER_KINDS);

/** The outflow of a loan payment or an investment contribution: money spent, though a transfer side. */
function isSpentOutflow(tx: CashFlowTransaction): boolean {
	return tx.transfer !== null && tx.amount < 0 && expenseKinds.has(tx.transfer.kind);
}

/**
 * Income, expense or transfer, as Sure's `Transaction::Search#apply_type_filter`
 * and `Rule::ConditionFilter::TransactionType` read it: every transfer side is
 * a transfer, a loan payment's or an investment contribution's outflow
 * included, and any other row follows its sign, zero being an expense. The
 * list's « Sens » filter and the rules' « type » condition share it;
 * `services/ledger/filter.ts` holds its SQL twin, tied by a parity test.
 * Exclusion and account settings leave the direction alone. What a cash-flow
 * report counts is `countsInCashFlow`'s question, not this one.
 */
export function direction(tx: CashFlowTransaction): Direction {
	if (tx.transfer !== null) {
		return "transfer";
	}

	return tx.amount > 0 ? "income" : "expense";
}

/**
 * `direction` as recurring detection, matching and bills read it until Story
 * 27.24 follows Sure's recurring transfers: the outflow of a loan payment or
 * an investment contribution is an expense, so a loan's monthly payment stays
 * a bill the household pays.
 */
export function recurringDirection(tx: CashFlowTransaction): Direction {
	if (tx.transfer !== null && !isSpentOutflow(tx)) {
		return "transfer";
	}

	return tx.amount > 0 ? "income" : "expense";
}

/** What `countsInCashFlow` reads: `direction`'s fields, the exclusion and pending flags. */
export type CountedTransaction = CashFlowTransaction & { excluded: boolean; pending: boolean };

/**
 * Whether a transaction enters a cash-flow report (AD-9): not excluded, not
 * pending, since its booked version counts once the bank settles it, and not
 * a transfer side unless it is the outflow of a loan payment or an investment
 * contribution, which Sure's `classification_sql` always counts as an
 * expense. Which accounts count is the caller's choice: `services/reports.ts`
 * leaves out every account Sure's `IncomeStatement#eligible_accounts` does.
 * `services/ledger/queries.ts` holds its SQL twin in `cashFlowByCategory`,
 * tied by a parity test. No trade ever counts, as Sure's `trades_subquery_sql`.
 */
export function countsInCashFlow(tx: CountedTransaction): boolean {
	return !tx.excluded && !tx.pending && (tx.transfer === null || isSpentOutflow(tx));
}

/** The signed sum of counted transactions sharing a category and a sign. */
export type CashFlowRow = { categoryId: string | null; amount: MinorUnits };

export type CashFlowCategory = {
	id: string;
	name: string;
	/** Shown beside a category, never read by either view: a row's side is its sign. */
	kind: CategoryKind;
	color: string;
	icon: CategoryIcon;
	parentId: string | null;
};

/** One line of a view; « Sans catégorie » has no id, name, colour or icon. */
export type CashFlowLine = {
	categoryId: string | null;
	name: string | null;
	color: string | null;
	icon: CategoryIcon | null;
	/** The side's sign: positive for income, negative for an expense (AD-5). */
	amount: MinorUnits;
	/** The line over its side's total. */
	share: number | null;
};

export type CashFlowBreakdown = {
	/** The sum of the income lines, never negative. */
	income: MinorUnits;
	/** The sum of the expense lines, never positive. */
	expenses: MinorUnits;
	lines: { income: CashFlowLine[]; expense: CashFlowLine[] };
};

/** A sub-category's own counted rows on one side, beside its parent's line. */
type SubcategoryLine = { categoryId: string; name: string; amount: MinorUnits };

/** Each side's sub-category lines, by their top-level category's id. */
export type SubcategoryLines = {
	income: ReadonlyMap<string, SubcategoryLine[]>;
	expense: ReadonlyMap<string, SubcategoryLine[]>;
};

/** Sure's `IncomeStatement::Totals`: each side by category, with its sub-categories. */
export type GrossCashFlow = CashFlowBreakdown & { subcategories: SubcategoryLines };

/** One calendar month's two views, as a series of months reads them. */
export type MonthBreakdown = {
	month: IsoMonth;
	gross: Pick<CashFlowBreakdown, "income" | "lines">;
	net: Pick<CashFlowBreakdown, "expenses" | "lines">;
};

type Side = keyof CashFlowBreakdown["lines"];

/** Sure's `classification_sql`: a counted row above zero is income, any other an expense. */
const sideOf = (amount: number): Side => (amount > 0 ? "income" : "expense");

const byName = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

type UnsharedLine = Omit<CashFlowLine, "share">;

/** By name, « Sans catégorie » last: the order among lines of the same size. */
const byLineName = (a: UnsharedLine, b: UnsharedLine) =>
	a.name === null ? 1 : b.name === null ? -1 : byName.compare(a.name, b.name);

function sortedWithShares(lines: readonly UnsharedLine[]) {
	const kept = lines.filter((line) => line.amount !== 0);
	const total = kept.reduce((sum, line) => sum + line.amount, 0);
	// Lines of the same size read by name, so the list never reorders between loads.
	const sorted = kept
		.toSorted(byLineName)
		.toSorted((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

	return {
		total: toMinorUnits(total),
		// Never zero once a line is kept: every line of a side shares its sign.
		lines: sorted.map((line) => ({ ...line, share: line.amount / total })),
	};
}

function breakdownOf(lines: Record<Side, readonly UnsharedLine[]>): CashFlowBreakdown {
	const income = sortedWithShares(lines.income);
	const expense = sortedWithShares(lines.expense);

	return {
		income: income.total,
		expenses: expense.total,
		lines: { income: income.lines, expense: expense.lines },
	};
}

const uncategorisedLine = (amount: MinorUnits): UnsharedLine => ({
	categoryId: null,
	name: null,
	color: null,
	icon: null,
	amount,
});

/**
 * The gross view (AD-9), Sure's `IncomeStatement::Totals` and
 * `build_period_total`: each row on the side of its sign, a sub-category's
 * rows rolled into its top-level parent, each category's side summed, so a
 * category may sit on both sides and a refund is income in its category.
 * Uncategorised rows make « Sans catégorie » on each side. A row whose
 * category is unknown counts as uncategorised rather than vanishing. The
 * category's kind is never read. Sub-category lines are each side's own
 * rows, as Sure's `subcategory_totals`.
 */
export function grossCashFlow(
	rows: readonly CashFlowRow[],
	categories: readonly CashFlowCategory[],
): GrossCashFlow {
	const byId = new Map(categories.map((category) => [category.id, category]));
	const sums: Record<Side, Map<string | null, number>> = { income: new Map(), expense: new Map() };
	const children: Record<Side, Map<string, Child>> = { income: new Map(), expense: new Map() };

	for (const row of rows) {
		const side = sideOf(row.amount);
		const own = row.categoryId === null ? undefined : byId.get(row.categoryId);
		const parent = own === undefined || own.parentId === null ? undefined : byId.get(own.parentId);
		const top = parent ?? own;
		const key = top?.id ?? null;
		sums[side].set(key, (sums[side].get(key) ?? 0) + row.amount);

		if (own !== undefined && parent !== undefined) {
			const current = children[side].get(own.id);
			children[side].set(own.id, {
				category: own,
				parentId: parent.id,
				amount: (current?.amount ?? 0) + row.amount,
			});
		}
	}

	const linesOf = (side: Side): UnsharedLine[] =>
		[...sums[side]].map(([id, amount]) => {
			const category = id === null ? undefined : byId.get(id);

			return category === undefined
				? uncategorisedLine(toMinorUnits(amount))
				: {
						categoryId: category.id,
						name: category.name,
						color: category.color,
						icon: category.icon,
						amount: toMinorUnits(amount),
					};
		});

	return {
		...breakdownOf({ income: linesOf("income"), expense: linesOf("expense") }),
		subcategories: {
			income: subcategoriesOf(children.income),
			expense: subcategoriesOf(children.expense),
		},
	};
}

/** A sub-category's rows on one side, beside its parent's id. */
type Child = { category: CashFlowCategory; parentId: string; amount: number };

/**
 * One side's sub-category sums by parent, largest first, by name among
 * equals. A sub-category whose rows cancel out is left out, as a line is.
 */
function subcategoriesOf(sums: ReadonlyMap<string, Child>): ReadonlyMap<string, SubcategoryLine[]> {
	const lines = new Map<string, SubcategoryLine[]>();

	for (const { category, parentId, amount } of sums.values()) {
		if (amount !== 0) {
			lines.set(parentId, [
				...(lines.get(parentId) ?? []),
				{ categoryId: category.id, name: category.name, amount: toMinorUnits(amount) },
			]);
		}
	}

	return new Map(
		[...lines].map(([parentId, items]) => [
			parentId,
			items.toSorted(
				(a, b) => Math.abs(b.amount) - Math.abs(a.amount) || byName.compare(a.name, b.name),
			),
		]),
	);
}

/**
 * The net view (AD-9), Sure's `net_category_totals`, derived from the gross
 * one so the two never disagree: each top-level category's income plus its
 * expense, « Sans catégorie » included as Sure's `:uncategorized` key. A
 * positive net is an income line, a negative one an expense line, zero is
 * dropped; each side's total is the sum of its lines.
 */
export function netCashFlow(gross: CashFlowBreakdown): CashFlowBreakdown {
	const nets = new Map<string | null, UnsharedLine>();

	for (const line of [...gross.lines.income, ...gross.lines.expense]) {
		const current = nets.get(line.categoryId);
		nets.set(line.categoryId, {
			categoryId: line.categoryId,
			name: line.name,
			color: line.color,
			icon: line.icon,
			amount: toMinorUnits((current?.amount ?? 0) + line.amount),
		});
	}

	const lines = [...nets.values()];

	return breakdownOf({
		income: lines.filter((line) => line.amount > 0),
		expense: lines.filter((line) => line.amount < 0),
	});
}
