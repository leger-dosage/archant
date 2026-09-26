import type { CategoryIcon } from "@archant/data/category-presets";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import type { CategoryKind } from "@archant/data/schema/categories";
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

/**
 * Income, expense or transfer, the one rule the list's filter and the future
 * dashboard share; `ledger.ts` holds its SQL twin, tied by a parity test. A
 * side of a transfer is a transfer, except the outflow of a loan payment or an
 * investment contribution: that money is spent. The outflow is the negative
 * side, on assets and liabilities alike. Exclusion and account settings leave
 * the direction alone; they decide whether a row counts, not which way it goes.
 */
export function direction(tx: CashFlowTransaction): Direction {
	const spentOutflow = tx.transfer !== null && tx.amount < 0 && expenseKinds.has(tx.transfer.kind);

	if (tx.transfer !== null && !spentOutflow) {
		return "transfer";
	}

	return tx.amount > 0 ? "income" : "expense";
}

/** What `countsInCashFlow` reads: `direction`'s fields, the exclusion and pending flags. */
export type CountedTransaction = CashFlowTransaction & { excluded: boolean; pending: boolean };

/**
 * Whether a transaction enters a cash-flow report: not excluded, not pending
 * (AD-9: its booked version counts once the bank settles it), and income or
 * expense by `direction`. Which accounts count is the caller's choice, the
 * reporting-currency set of `services/reports.ts`. `ledger.ts` holds its SQL
 * twin in `cashFlowByCategory`, tied by a parity test.
 */
export function countsInCashFlow(tx: CountedTransaction): boolean {
	return !tx.excluded && !tx.pending && direction(tx) !== "transfer";
}

/** The signed sum of counted transactions sharing a category and a sign. */
export type CashFlowRow = { categoryId: string | null; amount: MinorUnits };

export type CashFlowCategory = {
	id: string;
	name: string;
	kind: CategoryKind;
	color: string;
	icon: CategoryIcon;
	parentId: string | null;
};

/** One line of the breakdown; « Sans catégorie » has no id, name, colour or icon. */
export type CashFlowLine = {
	categoryId: string | null;
	name: string | null;
	color: string | null;
	icon: CategoryIcon | null;
	/** Signed: a refund lowers an expense line, which stays negative. */
	amount: MinorUnits;
	/** The line over its group's total, `null` when that total is zero. */
	share: number | null;
};

export type CashFlowBreakdown = {
	income: MinorUnits;
	expenses: MinorUnits;
	lines: { income: CashFlowLine[]; expense: CashFlowLine[] };
};

const byName = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

function sortedWithShares(lines: readonly Omit<CashFlowLine, "share">[]) {
	const kept = lines.filter((line) => line.amount !== 0);
	const total = kept.reduce((sum, line) => sum + line.amount, 0);
	// Stable: lines of the same size keep the order `linesOf` gives them.
	const sorted = kept.toSorted((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

	return {
		total: toMinorUnits(total),
		lines: sorted.map((line) => ({ ...line, share: total === 0 ? null : line.amount / total })),
	};
}

/**
 * Income and expenses by top-level category (AD-9). A sub-category's rows go
 * to its parent; a category line is the signed sum of its rows and sits in the
 * group of its category's kind, so a refund lowers its category and the group.
 * Uncategorised rows split by sign into « Sans catégorie » on each side. A row
 * whose category is unknown counts as uncategorised rather than vanishing.
 */
export function cashFlowBreakdown(
	rows: readonly CashFlowRow[],
	categories: readonly CashFlowCategory[],
): CashFlowBreakdown {
	const byId = new Map(categories.map((category) => [category.id, category]));
	const perCategory = new Map<string, { category: CashFlowCategory; amount: number }>();
	let uncategorisedIncome = 0;
	let uncategorisedExpense = 0;

	for (const row of rows) {
		const own = row.categoryId === null ? undefined : byId.get(row.categoryId);
		const parent = own === undefined || own.parentId === null ? undefined : byId.get(own.parentId);
		const top = parent ?? own;

		if (top === undefined) {
			if (row.amount > 0) {
				uncategorisedIncome += row.amount;
			} else {
				uncategorisedExpense += row.amount;
			}
		} else {
			const current = perCategory.get(top.id);
			perCategory.set(top.id, { category: top, amount: (current?.amount ?? 0) + row.amount });
		}
	}

	// By name, « Sans catégorie » last: the order among lines of the same size.
	const linesOf = (kind: CategoryKind, uncategorised: MinorUnits) => [
		...[...perCategory.values()]
			.filter((entry) => entry.category.kind === kind)
			.toSorted((a, b) => byName.compare(a.category.name, b.category.name))
			.map((entry) => ({
				categoryId: entry.category.id,
				name: entry.category.name,
				color: entry.category.color,
				icon: entry.category.icon,
				amount: toMinorUnits(entry.amount),
			})),
		{ categoryId: null, name: null, color: null, icon: null, amount: uncategorised },
	];
	const income = sortedWithShares(linesOf("income", toMinorUnits(uncategorisedIncome)));
	const expense = sortedWithShares(linesOf("expense", toMinorUnits(uncategorisedExpense)));

	return {
		income: income.total,
		expenses: expense.total,
		lines: { income: income.lines, expense: expense.lines },
	};
}
