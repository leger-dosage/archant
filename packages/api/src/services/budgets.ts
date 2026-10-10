import type { BudgetActuals, SpendingSegment } from "../domain/budgets/actuals.ts";
import type {
	BudgetCategoryLine,
	BudgetRow,
	MonthRows,
	TreeCategory,
	UncategorisedLine,
} from "../domain/budgets/categories.ts";
import type { MonthBounds } from "../domain/budgets/months.ts";
import type { RolloverMonth } from "../domain/budgets/rollover.ts";
import type { IsoDate, IsoMonth } from "../domain/dates.ts";
import type {
	BudgetCategoryInput,
	BudgetInput,
	BudgetMoveInput,
	BudgetRolloverInput,
	BudgetUpdateInput,
} from "../schemas/budgets.ts";
import type { ServiceDeps } from "./deps.ts";
import type { CashFlow } from "./reports.ts";

import {
	and,
	asc,
	desc,
	eq,
	gt,
	gte,
	inArray,
	isNotNull,
	lt,
	lte,
	min,
	ne,
	or,
	sum,
} from "drizzle-orm";

import type { CurrencyCode, MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { shiftMonth } from "@archant/data/months";
import { budgetCategories as budgetCategoryRows, budgets } from "@archant/data/schema/budgets";
import { categories } from "@archant/data/schema/categories";

import { actualsOf, spendingSegments, suggestions } from "../domain/budgets/actuals.ts";
import {
	budgetCategories,
	parentAfterChildSave,
	parentAfterOwnSave,
	spentByCategory,
} from "../domain/budgets/categories.ts";
import { budgetBounds, isBudgetMonth, neighbours } from "../domain/budgets/months.ts";
import { copiedRows, moveAllocation } from "../domain/budgets/moves.ts";
import { rolloverChain } from "../domain/budgets/rollover.ts";
import { today } from "../domain/dates.ts";
import { AppError } from "../lib/errors.ts";
import { validationError } from "../lib/zod-error.ts";
import {
	budgetCategorySchema,
	budgetMoveSchema,
	budgetRolloverBodySchema,
	budgetSchema,
	budgetUpdateSchema,
} from "../schemas/budgets.ts";
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
	/**
	 * The month « Copier » takes from, as Sure's `most_recent_initialized_budget`:
	 * the latest earlier month set up, gaps skipped; `null` once this one is
	 * set up, or without one.
	 */
	copySource: IsoMonth | null;
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

type Db = ServiceDeps["db"];

const notFound = () => new AppError("NOT_FOUND", "No budget can be set for this month.");

const notExpense = () => new AppError("NOT_FOUND", "No expense category has this id.");

/** The latest month before `month` that is set up, gaps skipped; `undefined` without one. */
function latestSetUpBefore(db: Db, month: IsoMonth) {
	return db
		.select()
		.from(budgets)
		.where(and(lt(budgets.month, month), isNotNull(budgets.budgetedSpending)))
		.orderBy(desc(budgets.month))
		.limit(1)
		.get();
}

/** A month's stored rows, by category: each amount beside its « Report » switch. */
async function storedRowsOf(db: Db, budgetId: string): Promise<Map<string, BudgetRow>> {
	const rows = await db
		.select({
			categoryId: budgetCategoryRows.categoryId,
			budgetedSpending: budgetCategoryRows.budgetedSpending,
			rolloverEnabled: budgetCategoryRows.rolloverEnabled,
		})
		.from(budgetCategoryRows)
		.where(eq(budgetCategoryRows.budgetId, budgetId));

	return new Map(
		rows.map((row) => [
			row.categoryId,
			{
				budgetedSpending: toMinorUnits(row.budgetedSpending),
				rolloverEnabled: row.rolloverEnabled,
			},
		]),
	);
}

/** A stored row as the rollover chain reads and rewrites it. */
type ChainRow = {
	id: string;
	categoryId: string;
	budgetedSpending: MinorUnits;
	rolloverEnabled: boolean;
	rolledOverAmount: MinorUnits;
};

/** A month set up, oldest first, with its rows: one without a row still breaks a carry. */
type ChainMonth = { month: IsoMonth; currency: string; rows: ChainRow[] };

/** The months set up within `from` and `to`, both inclusive, each with its rows. */
async function setUpMonths(
	db: Db,
	range: { from?: IsoMonth; to?: IsoMonth },
): Promise<ChainMonth[]> {
	const rows = await db
		.select({
			month: budgets.month,
			currency: budgets.currency,
			// `null` for a month set up without a row.
			row: {
				id: budgetCategoryRows.id,
				categoryId: budgetCategoryRows.categoryId,
				budgetedSpending: budgetCategoryRows.budgetedSpending,
				rolloverEnabled: budgetCategoryRows.rolloverEnabled,
				rolledOverAmount: budgetCategoryRows.rolledOverAmount,
			},
		})
		.from(budgets)
		.leftJoin(budgetCategoryRows, eq(budgetCategoryRows.budgetId, budgets.id))
		.where(
			and(
				isNotNull(budgets.budgetedSpending),
				range.from === undefined ? undefined : gte(budgets.month, range.from),
				range.to === undefined ? undefined : lte(budgets.month, range.to),
			),
		)
		.orderBy(asc(budgets.month));
	const months = new Map<IsoMonth, ChainMonth>();

	for (const { row, ...budget } of rows) {
		const month = months.get(budget.month) ?? { ...budget, rows: [] };

		months.set(budget.month, month);

		if (row !== null) {
			month.rows.push({
				...row,
				budgetedSpending: toMinorUnits(row.budgetedSpending),
				rolledOverAmount: toMinorUnits(row.rolledOverAmount),
			});
		}
	}

	return [...months.values()];
}

/** Every category, as the chain places it in today's tree. */
function treeCategories(db: Db) {
	return db
		.select({ id: categories.id, kind: categories.kind, parentId: categories.parentId })
		.from(categories);
}

/**
 * The carry into each row of `months`, as `rolloverChain` computes it from
 * each month's spending: `history` is `getCashFlowHistory`'s, reaching at
 * least the month before the last one.
 */
function chainOf(
	months: readonly ChainMonth[],
	history: readonly MonthRows[],
	allCategories: readonly TreeCategory[],
) {
	const rowsOf = new Map(history.map((item) => [item.month, item.rows]));

	return rolloverChain({
		categories: allCategories,
		months: months.map((month): RolloverMonth => ({
			month: month.month,
			currency: month.currency,
			rows: new Map(month.rows.map((row) => [row.categoryId, row])),
			spending: spentByCategory(rowsOf.get(month.month) ?? [], allCategories),
		})),
	});
}

/** A stored row's carry: what the last budget write stored, and what the chain gives it now. */
export type RolloverAmount = { id: string; stored: MinorUnits; carried: MinorUnits };

/**
 * What each stored row receives from the month before, the chain the page
 * reads: computed again from the first month set up that has a category with
 * rollover on, or a carry left by one switched off since. A row before that
 * month, or of a household that never turned rollover on, receives 0 and is
 * left out. A household without rollover pays one query.
 */
export async function rolloverAmounts(deps: ServiceDeps): Promise<RolloverAmount[]> {
	const relevant = await deps.db
		.select({ month: min(budgets.month) })
		.from(budgets)
		.innerJoin(budgetCategoryRows, eq(budgetCategoryRows.budgetId, budgets.id))
		.where(
			and(
				isNotNull(budgets.budgetedSpending),
				or(
					eq(budgetCategoryRows.rolloverEnabled, true),
					ne(budgetCategoryRows.rolledOverAmount, 0),
				),
			),
		)
		.get();
	const first = relevant?.month ?? null;

	if (first === null) {
		return [];
	}

	const months = await setUpMonths(deps.db, { from: first });
	const last = months.at(-1)?.month ?? first;
	const history = await getCashFlowHistory(deps, shiftMonth(last, 1));
	const chain = chainOf(months, history, await treeCategories(deps.db));

	return months.flatMap((month) =>
		month.rows.map((row) => ({
			id: row.id,
			stored: row.rolledOverAmount,
			carried: chain.get(month.month)?.get(row.categoryId) ?? toMinorUnits(0),
		})),
	);
}

/**
 * Sure's `RolloverCalculator#recompute!`, under the caller's write lock:
 * stores each `rolled_over_amount` that `rolloverAmounts` changes. Every
 * budget write calls it; a ledger write does not, so a read computes the
 * chain again rather than trusting it.
 */
async function refreshRollover(tx: Db, deps: ServiceDeps) {
	const changed = (await rolloverAmounts({ ...deps, db: tx })).filter(
		(row) => row.stored !== row.carried,
	);
	const now = Date.now();

	await changed.reduce<Promise<unknown>>(
		(previous, row) =>
			previous.then(() =>
				tx
					.update(budgetCategoryRows)
					.set({ rolledOverAmount: row.carried, updatedAt: now })
					.where(eq(budgetCategoryRows.id, row.id)),
			),
		Promise.resolve(),
	);
}

/** Creates a category's row in a month on its first amount, updates it after. */
function writeAmount(
	db: Db,
	budgetId: string,
	categoryId: string,
	budgetedSpending: MinorUnits,
	now: number,
) {
	return db
		.insert(budgetCategoryRows)
		.values({
			id: crypto.randomUUID(),
			budgetId,
			categoryId,
			budgetedSpending,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: [budgetCategoryRows.budgetId, budgetCategoryRows.categoryId],
			set: { budgetedSpending, updatedAt: now },
		});
}

/** A month set up, read under the caller's write lock; `BUDGET_NOT_SET_UP` otherwise. */
async function setUpBudget(db: Db, month: IsoMonth) {
	const budget = await db.select().from(budgets).where(eq(budgets.month, month)).get();

	if (budget === undefined || budget.budgetedSpending === null) {
		throw new AppError("BUDGET_NOT_SET_UP", "Set this month's budget before its categories.");
	}

	return budget;
}

/** The current month in `APP_TIMEZONE`, and the months a budget may cover. */
async function budgetMonths(deps: ServiceDeps) {
	const current = today(deps.timeZone).slice(0, 7);

	return { current, bounds: budgetBounds(current, await oldestEntryDate(deps)) };
}

/**
 * A month's budget beside its actuals and suggestions. Never writes: a month
 * not set up has no row, and reading it creates none, where Sure bootstraps
 * one on page open. What each category received is the rollover chain
 * computed again from the ledger as it stands, never the stored amount, which
 * only the next budget write refreshes. A month out of bounds is `NOT_FOUND`.
 */
export async function getBudget(deps: ServiceDeps, month: IsoMonth): Promise<BudgetMonth> {
	const { current, bounds } = await budgetMonths(deps);

	if (!isBudgetMonth(month, bounds)) {
		throw notFound();
	}

	const [row, chainMonths, { cashFlow, gross, rows, categories: allCategories }, history, source] =
		await Promise.all([
			deps.db.select().from(budgets).where(eq(budgets.month, month)).get(),
			setUpMonths(deps.db, { to: month }),
			getCashFlowWithRows(deps, month),
			// Every earlier month: the suggestions and the medians keep those
			// before the current one, the chain needs them all.
			getCashFlowHistory(deps, month),
			latestSetUpBefore(deps.db, month),
		]);
	const budgetedSpending = row?.budgetedSpending ?? null;
	const expectedIncome = row?.expectedIncome ?? null;
	// A month not set up has no row: its categories have 0 and nothing came in.
	const shown = chainMonths.find((item) => item.month === month)?.rows ?? [];
	const carried = chainOf(chainMonths, history, allCategories).get(month);
	const envelopes = budgetCategories({
		categories: allCategories,
		amounts: new Map(shown.map((item) => [item.categoryId, item.budgetedSpending])),
		rollover: new Map(
			shown.map((item) => [
				item.categoryId,
				{
					enabled: item.rolloverEnabled,
					carried: carried?.get(item.categoryId) ?? toMinorUnits(0),
				},
			]),
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
		copySource: budgetedSpending === null ? (source?.month ?? null) : null,
		budgetedSpending: budgetedSpending === null ? null : toMinorUnits(budgetedSpending),
		expectedIncome: expectedIncome === null ? null : toMinorUnits(expectedIncome),
		actual: actualsOf({ net: cashFlow, gross }),
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
 * Under the write lock, so two saves of one month never both insert. A month
 * set up for the first time inherits each expense category's rollover switch
 * that is on in the latest earlier month set up, as Sure's
 * `inherited_rollover_flags`, through a row at 0.
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

			await writeTotals(tx, month, { currency, ...parsed.data });
			await refreshRollover(tx, deps);
		},
		{ behavior: "immediate" },
	);

	return getBudget(deps, month);
}

/**
 * `saveBudget`'s write, under the caller's write lock and in its bounds:
 * creates the month's row on its first save, updates it after, and gives a
 * month set up for the first time the rollover switches it inherits.
 */
async function writeTotals(
	tx: Db,
	month: IsoMonth,
	totals: { currency: CurrencyCode; budgetedSpending: MinorUnits; expectedIncome: MinorUnits },
) {
	const now = Date.now();
	const amounts = { ...totals, updatedAt: now };
	const before = await tx.select().from(budgets).where(eq(budgets.month, month)).get();
	const budget = await tx
		.insert(budgets)
		.values({ id: crypto.randomUUID(), month, ...amounts, createdAt: now })
		.onConflictDoUpdate({ target: budgets.month, set: amounts })
		.returning({ id: budgets.id })
		.get();

	if (before === undefined || before.budgetedSpending === null) {
		await inheritRollover(tx, month, budget.id, now);
	}
}

/**
 * Sure's `inherited_rollover_flags`: a row at 0, rollover on, for each
 * expense category whose switch is on in the latest month set up before
 * `month`. A month not set up has no row yet, so nothing here collides.
 */
async function inheritRollover(tx: Db, month: IsoMonth, budgetId: string, now: number) {
	const source = await latestSetUpBefore(tx, month);

	if (source === undefined) {
		return;
	}

	const inherited = await tx
		.select({ categoryId: budgetCategoryRows.categoryId })
		.from(budgetCategoryRows)
		.innerJoin(categories, eq(categories.id, budgetCategoryRows.categoryId))
		.where(
			and(
				eq(budgetCategoryRows.budgetId, source.id),
				eq(budgetCategoryRows.rolloverEnabled, true),
				eq(categories.kind, "expense"),
			),
		);

	if (inherited.length > 0) {
		await tx
			.insert(budgetCategoryRows)
			.values(
				inherited.map(({ categoryId }) => ({
					id: crypto.randomUUID(),
					budgetId,
					categoryId,
					budgetedSpending: 0,
					rolloverEnabled: true,
					createdAt: now,
					updatedAt: now,
				})),
			)
			.onConflictDoNothing();
	}
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

			const budget = await setUpBudget(tx, month);
			const category = await tx
				.select()
				.from(categories)
				.where(eq(categories.id, categoryId))
				.get();

			// Only expense categories carry an amount, as income is one figure per month.
			if (category === undefined || category.kind !== "expense") {
				throw notExpense();
			}

			await writeCategoryAmount(tx, budget.id, category, amount);
			await refreshRollover(tx, deps);
		},
		{ behavior: "immediate" },
	);

	return getBudget(deps, month);
}

/**
 * `saveCategoryBudget`'s write, under the caller's write lock, in a month set
 * up and for an expense category: its amount, then its parent's, as
 * `parentAfterOwnSave` and `parentAfterChildSave` compute them.
 */
async function writeCategoryAmount(
	tx: Db,
	budgetId: string,
	category: { id: string; parentId: string | null },
	amount: MinorUnits,
) {
	const amountOf = async (id: string) =>
		toMinorUnits(
			(
				await tx
					.select({ amount: budgetCategoryRows.budgetedSpending })
					.from(budgetCategoryRows)
					.where(
						and(eq(budgetCategoryRows.budgetId, budgetId), eq(budgetCategoryRows.categoryId, id)),
					)
					.get()
			)?.amount ?? 0,
		);
	const now = Date.now();
	const write = (id: string, budgetedSpending: MinorUnits) =>
		writeAmount(tx, budgetId, id, budgetedSpending, now);
	// The children's stored amounts under `parentId`, `except` one: a
	// shared child's is 0, so this is what the ring-fenced ones hold.
	const childrenOf = async (parentId: string, except?: string) => {
		const [children] = await tx
			.select({ total: sum(budgetCategoryRows.budgetedSpending).mapWith(Number) })
			.from(budgetCategoryRows)
			.innerJoin(categories, eq(categories.id, budgetCategoryRows.categoryId))
			.where(
				and(
					eq(budgetCategoryRows.budgetId, budgetId),
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
	} else {
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
	}
}

/**
 * Sure's `UpdateBudget`, for an assistant: sets a month's total, expected
 * income and category amounts in one transaction, through the writes
 * `saveBudget` and `saveCategoryBudget` make, so a refusal anywhere leaves
 * the month as it was. A field absent keeps its stored value; a month not
 * set up needs both the total and the income, as the form does, so a half
 * set-up month never exists. Categories follow, subcategories first and
 * parents last as Sure's, so a parent given beside its child keeps the amount
 * given; a category amount needs the month set up, by this call or before.
 * Answers the month, as `getBudget` does.
 */
export async function updateBudget(
	deps: ServiceDeps,
	month: IsoMonth,
	input: BudgetUpdateInput,
): Promise<BudgetMonth> {
	const currency = getReportingCurrency();
	const parsed = budgetUpdateSchema(currency).safeParse(input);

	if (!parsed.success) {
		throw validationError(parsed.error);
	}

	const { budgetedSpending, expectedIncome, categories: categoryAmounts = [] } = parsed.data;

	await deps.db.transaction(
		async (tx) => {
			const { bounds } = await budgetMonths({ ...deps, db: tx });

			if (!isBudgetMonth(month, bounds)) {
				throw notFound();
			}

			if (budgetedSpending !== undefined || expectedIncome !== undefined) {
				const stored = await tx.select().from(budgets).where(eq(budgets.month, month)).get();
				const storedTotal = stored?.budgetedSpending ?? null;
				const storedIncome = stored?.expectedIncome ?? null;
				const total = budgetedSpending ?? (storedTotal === null ? null : toMinorUnits(storedTotal));
				const income =
					expectedIncome ?? (storedIncome === null ? null : toMinorUnits(storedIncome));

				// Only a month not set up stores neither: both are then required.
				if (total === null || income === null) {
					throw new AppError("VALIDATION_ERROR", "The request is invalid.", [
						...(total === null ? [{ path: "budgetedSpending", code: "required" }] : []),
						...(income === null ? [{ path: "expectedIncome", code: "required" }] : []),
					]);
				}

				await writeTotals(tx, month, {
					currency,
					budgetedSpending: total,
					expectedIncome: income,
				});
			}

			if (categoryAmounts.length > 0) {
				const budget = await setUpBudget(tx, month);
				const found = await tx
					.select({ id: categories.id, parentId: categories.parentId, kind: categories.kind })
					.from(categories)
					.where(
						inArray(
							categories.id,
							categoryAmounts.map((entry) => entry.categoryId),
						),
					);
				const byId = new Map(found.map((category) => [category.id, category]));
				const writes = categoryAmounts.map((entry) => {
					const category = byId.get(entry.categoryId);

					// Only expense categories carry an amount, as income is one figure per month.
					if (category === undefined || category.kind !== "expense") {
						throw notExpense();
					}

					return { category, amount: entry.budgeted };
				});
				// Subcategories first: each lifts its parent, which a parent given
				// here then sets, never below what its ring-fenced children hold.
				const ordered = [
					...writes.filter(({ category }) => category.parentId !== null),
					...writes.filter(({ category }) => category.parentId === null),
				];

				// In sequence, as every other write on this one connection.
				await ordered.reduce<Promise<unknown>>(
					(previous, { category, amount }) =>
						previous.then(() => writeCategoryAmount(tx, budget.id, category, amount)),
					Promise.resolve(),
				);
			}

			await refreshRollover(tx, deps);
		},
		{ behavior: "immediate" },
	);

	return getBudget(deps, month);
}

/**
 * Sure's `BudgetsController#copy_previous`: a month not set up takes the
 * total, the expected income and each category's amount and rollover switch
 * of the latest earlier month set up, gaps skipped, as `copiedRows` keeps
 * them; what came in is computed again, never copied. Refused
 * on a month set up, never overwritten, and without a month to copy.
 * Answers the month, as `getBudget` does, and the month copied: the one read
 * under the write lock, which a month set up since the page opened can change.
 */
export async function copyBudget(
	deps: ServiceDeps,
	month: IsoMonth,
): Promise<BudgetMonth & { copiedFrom: IsoMonth }> {
	const currency = getReportingCurrency();

	const copiedFrom = await deps.db.transaction(
		async (tx) => {
			const { bounds } = await budgetMonths({ ...deps, db: tx });

			if (!isBudgetMonth(month, bounds)) {
				throw notFound();
			}

			const target = await tx.select().from(budgets).where(eq(budgets.month, month)).get();

			if (target !== undefined && target.budgetedSpending !== null) {
				throw new AppError("BUDGET_ALREADY_SET_UP", "This month's budget is already set up.");
			}

			const source = await latestSetUpBefore(tx, month);

			if (source === undefined) {
				throw new AppError("NOT_FOUND", "No earlier month is set up to copy from.");
			}

			const sourceRows = await storedRowsOf(tx, source.id);
			const allCategories = await tx
				.select({ id: categories.id, parentId: categories.parentId, kind: categories.kind })
				.from(categories);
			const now = Date.now();
			const amounts = {
				currency,
				budgetedSpending: source.budgetedSpending,
				expectedIncome: source.expectedIncome,
				updatedAt: now,
			};
			const budget = await tx
				.insert(budgets)
				.values({ id: crypto.randomUUID(), month, ...amounts, createdAt: now })
				.onConflictDoUpdate({ target: budgets.month, set: amounts })
				.returning({ id: budgets.id })
				.get();
			const copied = [...copiedRows({ categories: allCategories, source: sourceRows })];

			// A month not set up has no amount of its own: a category's amount
			// needs the month set up first, so nothing here can collide.
			if (copied.length > 0) {
				await tx.insert(budgetCategoryRows).values(
					copied.map(([categoryId, { budgetedSpending, rolloverEnabled }]) => ({
						id: crypto.randomUUID(),
						budgetId: budget.id,
						categoryId,
						budgetedSpending,
						rolloverEnabled,
						createdAt: now,
						updatedAt: now,
					})),
				);
			}

			await refreshRollover(tx, deps);

			return source.month;
		},
		{ behavior: "immediate" },
	);

	return { ...(await getBudget(deps, month)), copiedFrom };
}

/**
 * Sure's `BudgetCategory.move_allocation!`: moves an amount from one expense
 * category to another in a month set up, both sides in one transaction, as
 * `moveAllocation` computes them. A refusal is a field of `VALIDATION_ERROR`,
 * so the dialog shows it under its field. Answers the month, as `getBudget` does.
 */
export async function moveCategoryBudget(
	deps: ServiceDeps,
	month: IsoMonth,
	input: BudgetMoveInput,
): Promise<BudgetMonth> {
	const parsed = budgetMoveSchema(getReportingCurrency()).safeParse(input);

	if (!parsed.success) {
		throw validationError(parsed.error);
	}

	const { fromCategoryId, toCategoryId, amount } = parsed.data;

	await deps.db.transaction(
		async (tx) => {
			const { bounds } = await budgetMonths({ ...deps, db: tx });

			if (!isBudgetMonth(month, bounds)) {
				throw notFound();
			}

			const budget = await setUpBudget(tx, month);
			const expense = await tx
				.select({ id: categories.id, parentId: categories.parentId })
				.from(categories)
				.where(eq(categories.kind, "expense"));
			const from = expense.find((category) => category.id === fromCategoryId);
			const to = expense.find((category) => category.id === toCategoryId);

			// « Sans catégorie » has no row to give from or to receive.
			if (from === undefined || to === undefined) {
				throw notExpense();
			}

			const stored = await storedRowsOf(tx, budget.id);
			const result = moveAllocation({
				categories: expense,
				amounts: new Map([...stored].map(([id, row]) => [id, row.budgetedSpending])),
				from,
				to,
				amount,
			});

			if ("refusal" in result) {
				throw new AppError("VALIDATION_ERROR", "The request is invalid.", [result.refusal]);
			}

			const now = Date.now();

			// In sequence, as every other write on this one connection.
			await [...result.changes].reduce<Promise<unknown>>(
				(previous, [categoryId, budgetedSpending]) =>
					previous.then(() => writeAmount(tx, budget.id, categoryId, budgetedSpending, now)),
				Promise.resolve(),
			);
			await refreshRollover(tx, deps);
		},
		{ behavior: "immediate" },
	);

	return getBudget(deps, month);
}

/**
 * Sure's rollover switch on one expense category: sets it in a month set up
 * and in every later month set up, turning it on through a row at 0 where the
 * category has none, as Sure's `propagate_rollover_choice_forward!`, so the
 * latest choice holds from there on; earlier months keep theirs. Refused as a category's amount
 * is. Answers the month, as `getBudget` does.
 */
export async function setCategoryRollover(
	deps: ServiceDeps,
	month: IsoMonth,
	categoryId: string,
	input: BudgetRolloverInput,
): Promise<BudgetMonth> {
	const parsed = budgetRolloverBodySchema.safeParse(input);

	if (!parsed.success) {
		throw validationError(parsed.error);
	}

	const { rolloverEnabled } = parsed.data;

	await deps.db.transaction(
		async (tx) => {
			const { bounds } = await budgetMonths({ ...deps, db: tx });

			if (!isBudgetMonth(month, bounds)) {
				throw notFound();
			}

			const budget = await setUpBudget(tx, month);
			const category = await tx
				.select({ kind: categories.kind })
				.from(categories)
				.where(eq(categories.id, categoryId))
				.get();

			if (category === undefined || category.kind !== "expense") {
				throw notExpense();
			}

			const later = await tx
				.select({ id: budgets.id })
				.from(budgets)
				.where(and(gt(budgets.month, month), isNotNull(budgets.budgetedSpending)));
			const budgetIds = [budget, ...later].map(({ id }) => id);
			const now = Date.now();

			if (rolloverEnabled) {
				await tx
					.insert(budgetCategoryRows)
					.values(
						budgetIds.map((budgetId) => ({
							id: crypto.randomUUID(),
							budgetId,
							categoryId,
							budgetedSpending: 0,
							rolloverEnabled,
							createdAt: now,
							updatedAt: now,
						})),
					)
					.onConflictDoUpdate({
						target: [budgetCategoryRows.budgetId, budgetCategoryRows.categoryId],
						set: { rolloverEnabled, updatedAt: now },
					});
			} else {
				// A month without the category's row already reads as off.
				await tx
					.update(budgetCategoryRows)
					.set({ rolloverEnabled, updatedAt: now })
					.where(
						and(
							eq(budgetCategoryRows.categoryId, categoryId),
							inArray(budgetCategoryRows.budgetId, budgetIds),
						),
					);
			}

			await refreshRollover(tx, deps);
		},
		{ behavior: "immediate" },
	);

	return getBudget(deps, month);
}
