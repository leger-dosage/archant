import type { BudgetActuals, SpendingSegment } from "../domain/budgets/actuals.ts";
import type { BudgetCategoryLine, UncategorisedLine } from "../domain/budgets/categories.ts";
import type { MonthBounds } from "../domain/budgets/months.ts";
import type { IsoDate, IsoMonth } from "../domain/dates.ts";
import type { BudgetCategoryInput, BudgetInput } from "../schemas/budgets.ts";
import type { ServiceDeps } from "./deps.ts";
import type { CashFlow } from "./reports.ts";

import { and, eq, ne, sum } from "drizzle-orm";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { budgetCategories as budgetCategoryRows, budgets } from "@archant/data/schema/budgets";
import { categories } from "@archant/data/schema/categories";

import { actualsOf, spendingSegments, suggestions } from "../domain/budgets/actuals.ts";
import {
	budgetCategories,
	parentAfterChildSave,
	parentAfterOwnSave,
} from "../domain/budgets/categories.ts";
import { budgetBounds, isBudgetMonth, neighbours } from "../domain/budgets/months.ts";
import { today } from "../domain/dates.ts";
import { AppError } from "../lib/errors.ts";
import { validationError } from "../lib/zod-error.ts";
import { budgetCategorySchema, budgetSchema } from "../schemas/budgets.ts";
import { oldestEntryDate } from "./ledger/queries.ts";
import { getCashFlowHistory, getCashFlowWithRows } from "./reports.ts";
import { getReportingCurrency } from "./settings.ts";

/** A month's budget as the page shows it, whether set up or not. */
export type BudgetMonth = {
	month: IsoMonth;
	/** The month's first and last days, which a category's drill-down filters on. */
	from: IsoDate;
	to: IsoDate;
	/** The reporting currency every amount below is in. */
	currency: string;
	/** `budgetedSpending` is set, as Sure's `initialized?`. */
	setUp: boolean;
	budgetedSpending: MinorUnits | null;
	expectedIncome: MinorUnits | null;
	/** The month's cash flow (AD-9), spending and income positive. */
	actual: BudgetActuals;
	/** The donut's slices: each top-level expense line that spent, largest first. */
	segments: SpendingSegment[];
	/**
	 * Every expense category's envelope, parents by name with their children
	 * by name under them, whether the month is set up or not.
	 */
	categories: BudgetCategoryLine[];
	/** « Sans catégorie »: what the total leaves unallocated, never stored. */
	uncategorised: UncategorisedLine;
	/** The top-level expense categories' amounts, summed: « Valider » waits while it passes the total. */
	allocated: MinorUnits;
	/** The medians « Suggérer » fills; `null` without an earlier month to take one from. */
	suggested: { spending: MinorUnits | null; income: MinorUnits | null };
	/** Where the arrows lead, `null` past a bound. */
	previousMonth: IsoMonth | null;
	nextMonth: IsoMonth | null;
	/** The months the picker offers, both inclusive. */
	bounds: MonthBounds;
	/** Active accounts included in reports but held in another currency, by name. */
	leftOut: CashFlow["leftOut"];
};

const notFound = () => new AppError("NOT_FOUND", "No budget can be set for this month.");

/** The current month in `APP_TIMEZONE`, and the months a budget may cover. */
async function budgetMonths(deps: ServiceDeps) {
	const current = today(deps.timeZone).slice(0, 7);

	return { current, bounds: budgetBounds(current, await oldestEntryDate(deps)) };
}

/**
 * A month's budget beside its actuals and suggestions. Never writes: a month
 * not set up has no row, and reading it creates none, where Sure bootstraps
 * one on page open. A month out of bounds is `NOT_FOUND`.
 */
export async function getBudget(deps: ServiceDeps, month: IsoMonth): Promise<BudgetMonth> {
	const { current, bounds } = await budgetMonths(deps);

	if (!isBudgetMonth(month, bounds)) {
		throw notFound();
	}

	const [row, amounts, { cashFlow, rows, categories: allCategories }, history] = await Promise.all([
		deps.db.select().from(budgets).where(eq(budgets.month, month)).get(),
		deps.db
			.select({
				categoryId: budgetCategoryRows.categoryId,
				budgetedSpending: budgetCategoryRows.budgetedSpending,
			})
			.from(budgetCategoryRows)
			.innerJoin(budgets, eq(budgets.id, budgetCategoryRows.budgetId))
			.where(eq(budgets.month, month)),
		getCashFlowWithRows(deps, month),
		getCashFlowHistory(deps, month < current ? month : current),
	]);
	const budgetedSpending = row?.budgetedSpending ?? null;
	const expectedIncome = row?.expectedIncome ?? null;
	const envelopes = budgetCategories({
		categories: allCategories,
		amounts: new Map(
			amounts.map((amount) => [amount.categoryId, toMinorUnits(amount.budgetedSpending)]),
		),
		rows,
		history,
		shown: month,
		current,
		budgetedSpending: budgetedSpending === null ? null : toMinorUnits(budgetedSpending),
	});

	return {
		month,
		from: cashFlow.from,
		to: cashFlow.to,
		currency: cashFlow.currency,
		setUp: budgetedSpending !== null,
		budgetedSpending: budgetedSpending === null ? null : toMinorUnits(budgetedSpending),
		expectedIncome: expectedIncome === null ? null : toMinorUnits(expectedIncome),
		actual: actualsOf(cashFlow),
		segments: spendingSegments(cashFlow.lines.expense),
		...envelopes,
		suggested: suggestions(history, month, current),
		...neighbours(month, bounds),
		bounds,
		leftOut: cashFlow.leftOut,
	};
}

/**
 * Sets a month's planned spending and expected income, in the reporting
 * currency: creates the month's row on its first save, updates it after.
 * Under the write lock, so two saves of one month never both insert.
 */
export async function saveBudget(
	deps: ServiceDeps,
	month: IsoMonth,
	input: BudgetInput,
): Promise<BudgetMonth> {
	const currency = getReportingCurrency();
	// Parsed before the write lock: checking text needs no database.
	const parsed = budgetSchema(currency).safeParse(input);

	if (!parsed.success) {
		throw validationError(parsed.error);
	}

	await deps.db.transaction(
		async (tx) => {
			const { bounds } = await budgetMonths({ ...deps, db: tx });

			if (!isBudgetMonth(month, bounds)) {
				throw notFound();
			}

			const now = Date.now();
			const amounts = { currency, ...parsed.data, updatedAt: now };

			await tx
				.insert(budgets)
				.values({ id: crypto.randomUUID(), month, ...amounts, createdAt: now })
				.onConflictDoUpdate({ target: budgets.month, set: amounts });
		},
		{ behavior: "immediate" },
	);

	return getBudget(deps, month);
}

/**
 * Sets one expense category's amount in a month set up, as Sure's
 * `update_budgeted_spending!`: creates its row on the first save. A
 * subcategory's save also sets its parent to its children's amounts plus its
 * own reserve, creating the parent's row if needed, in the same transaction;
 * a parent's own save never goes below its ring-fenced children.
 * Answers the whole month, as `getBudget` does.
 */
export async function saveCategoryBudget(
	deps: ServiceDeps,
	month: IsoMonth,
	categoryId: string,
	input: BudgetCategoryInput,
): Promise<BudgetMonth> {
	const parsed = budgetCategorySchema(getReportingCurrency()).safeParse(input);

	if (!parsed.success) {
		throw validationError(parsed.error);
	}

	const amount = parsed.data.budgetedSpending;

	await deps.db.transaction(
		async (tx) => {
			const { bounds } = await budgetMonths({ ...deps, db: tx });

			if (!isBudgetMonth(month, bounds)) {
				throw notFound();
			}

			const budget = await tx.select().from(budgets).where(eq(budgets.month, month)).get();

			if (budget === undefined || budget.budgetedSpending === null) {
				throw new AppError("BUDGET_NOT_SET_UP", "Set this month's budget before its categories.");
			}

			const category = await tx
				.select()
				.from(categories)
				.where(eq(categories.id, categoryId))
				.get();

			// Only expense categories carry an amount, as income is one figure per month.
			if (category === undefined || category.kind !== "expense") {
				throw new AppError("NOT_FOUND", "No expense category has this id.");
			}

			const amountOf = async (id: string) =>
				toMinorUnits(
					(
						await tx
							.select({ amount: budgetCategoryRows.budgetedSpending })
							.from(budgetCategoryRows)
							.where(
								and(
									eq(budgetCategoryRows.budgetId, budget.id),
									eq(budgetCategoryRows.categoryId, id),
								),
							)
							.get()
					)?.amount ?? 0,
				);
			const now = Date.now();
			const write = (id: string, budgetedSpending: MinorUnits) =>
				tx
					.insert(budgetCategoryRows)
					.values({
						id: crypto.randomUUID(),
						budgetId: budget.id,
						categoryId: id,
						budgetedSpending,
						createdAt: now,
						updatedAt: now,
					})
					.onConflictDoUpdate({
						target: [budgetCategoryRows.budgetId, budgetCategoryRows.categoryId],
						set: { budgetedSpending, updatedAt: now },
					});
			// The children's stored amounts under `parentId`, `except` one: a
			// shared child's is 0, so this is what the ring-fenced ones hold.
			const childrenOf = async (parentId: string, except?: string) => {
				const [children] = await tx
					.select({ total: sum(budgetCategoryRows.budgetedSpending).mapWith(Number) })
					.from(budgetCategoryRows)
					.innerJoin(categories, eq(categories.id, budgetCategoryRows.categoryId))
					.where(
						and(
							eq(budgetCategoryRows.budgetId, budget.id),
							eq(categories.parentId, parentId),
							except === undefined ? undefined : ne(budgetCategoryRows.categoryId, except),
						),
					);

				return toMinorUnits(children?.total ?? 0);
			};

			if (category.parentId === null) {
				await write(
					category.id,
					parentAfterOwnSave({ typed: amount, children: await childrenOf(category.id) }),
				);

				return;
			}

			const previousChild = await amountOf(category.id);

			await write(category.id, amount);
			await write(
				category.parentId,
				parentAfterChildSave({
					parent: await amountOf(category.parentId),
					siblings: await childrenOf(category.parentId, category.id),
					previousChild,
					child: amount,
				}),
			);
		},
		{ behavior: "immediate" },
	);

	return getBudget(deps, month);
}
