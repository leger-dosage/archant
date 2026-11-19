import type { BudgetActuals, SpendingSegment } from "../domain/budgets/actuals.ts";
import type {
	BudgetCategoryLine,
	BudgetRow,
	TreeCategory,
	UncategorisedLine,
} from "../domain/budgets/categories.ts";
import type { MonthBounds } from "../domain/budgets/months.ts";
import type { RolloverMonth } from "../domain/budgets/rollover.ts";
import type { CashFlowRow } from "../domain/cash-flow.ts";
import type { IsoDate, IsoMonth } from "../domain/dates.ts";
import type {
	BudgetCategoryInput,
	BudgetInput,
	BudgetMoveInput,
	BudgetRolloverInput,
} from "../schemas/budgets.ts";
import type { ServiceDeps } from "./deps.ts";
import type { BillReservations } from "./recurring/budget-reservations.ts";
import type { CashFlow } from "./reports.ts";

import {
	DrizzleQueryError,
	and,
	asc,
	desc,
	eq,
	gt,
	gte,
	inArray,
	isNotNull,
	isNull,
	lt,
	lte,
	min,
	ne,
	or,
	sum,
} from "drizzle-orm";

import type { CurrencyCode, MinorUnits } from "@archant/data/money";
import { parseAmount, toMinorUnits } from "@archant/data/money";
import { shiftMonth } from "@archant/data/months";
import { accounts } from "@archant/data/schema/accounts";
import { budgetCategories as budgetCategoryRows, budgets } from "@archant/data/schema/budgets";
import { categories } from "@archant/data/schema/categories";

import { actualsOf, spendingSegments } from "../domain/budgets/actuals.ts";
import {
	budgetCategories,
	parentAfterChildSave,
	spentByCategory,
} from "../domain/budgets/categories.ts";
import {
	budgetBounds,
	budgetMonthOf,
	budgetPeriod,
	isBudgetMonth,
	neighbours,
} from "../domain/budgets/months.ts";
import { copiedRows, moveAllocation } from "../domain/budgets/moves.ts";
import { rolloverChain } from "../domain/budgets/rollover.ts";
import { addDays, daysBetween, today } from "../domain/dates.ts";
import { AppError } from "../lib/errors.ts";
import { validationError } from "../lib/zod-error.ts";
import {
	budgetCategorySchema,
	budgetRolloverBodySchema,
	budgetSchema,
} from "../schemas/budgets.ts";
import { UNCATEGORISED } from "../schemas/transactions.ts";
import { accountScope } from "./account-access.ts";
import { assertBudgetWrite, budgetScope } from "./budget-access.ts";
import { cashFlowByDay, oldestEntryDate } from "./ledger/queries.ts";
import { budgetBillReservations } from "./recurring/budget-reservations.ts";
import {
	cashFlowAccounts,
	getCashFlowMonths,
	getCashFlowWithRows,
	statisticsOf,
} from "./reports.ts";
import { getMonthStartDay, getReportingCurrency } from "./settings.ts";

/** A month's budget as the page shows it, whether set up or not. */
export type BudgetMonth = {
	month: IsoMonth;
	isCurrent: boolean;
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
	 * Every category's envelope, parents by name with their children
	 * by name under them, whether the month is set up or not.
	 */
	categories: BudgetCategoryLine[];
	/** « Sans catégorie »: what the total leaves unallocated, never stored. */
	uncategorised: UncategorisedLine;
	/** Outstanding bills by their own category, in the reporting currency. */
	billReservations: BillReservations;
	/** The top-level categories' amounts, summed: « Valider » waits while it passes the total. */
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
	canReadTransactions: boolean;
};

type Db = ServiceDeps["db"];

const notFound = () => new AppError("NOT_FOUND", "No budget can be set for this month.");

const unknownCategory = () => new AppError("NOT_FOUND", "No category has this id.");

/** The latest month before `month` that is set up, gaps skipped; `undefined` without one. */
function latestSetUpBefore(db: Db, month: IsoMonth, ownerId?: string | null) {
	return db
		.select()
		.from(budgets)
		.where(and(budgetScope(ownerId), lt(budgets.month, month), isNotNull(budgets.budgetedSpending)))
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
type ChainMonth = {
	month: IsoMonth;
	startDate: IsoDate;
	endDate: IsoDate;
	currency: string;
	rows: ChainRow[];
};

/** The months set up within `from` and `to`, both inclusive, each with its rows. */
async function setUpMonths(
	db: Db,
	range: { from?: IsoMonth; to?: IsoMonth },
	ownerId?: string | null,
): Promise<ChainMonth[]> {
	const rows = await db
		.select({
			month: budgets.month,
			startDate: budgets.startDate,
			endDate: budgets.endDate,
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
				budgetScope(ownerId),
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
	return db.select({ id: categories.id, parentId: categories.parentId }).from(categories);
}

/** Saved periods can overlap or have gaps after the household changes its start day. */
async function chainOf(
	deps: ServiceDeps,
	months: readonly ChainMonth[],
	allCategories: readonly TreeCategory[],
) {
	const first = months[0];

	if (
		first === undefined ||
		!months.some((month) => month.rows.some((row) => row.rolloverEnabled))
	) {
		return new Map<IsoMonth, Map<string, MinorUnits>>();
	}

	const to = months.reduce(
		(last, month) => (month.endDate > last ? month.endDate : last),
		first.endDate,
	);
	const { counted } = await cashFlowAccounts(deps);
	const history = await cashFlowByDay(deps, {
		from: first.startDate,
		to,
		accountIds: counted.map((row) => row.id),
	});
	const byDay = new Map<IsoDate, CashFlowRow[]>();

	for (const { date, ...row } of history) {
		const rows = byDay.get(date);

		if (rows === undefined) {
			byDay.set(date, [row]);
		} else {
			rows.push(row);
		}
	}

	return rolloverChain({
		categories: allCategories,
		months: months.map((month): RolloverMonth => {
			const rows: CashFlowRow[] = [];

			const days = daysBetween(month.startDate, month.endDate) + 1;

			for (let offset = 0; offset < days; offset += 1) {
				rows.push(...(byDay.get(addDays(month.startDate, offset)) ?? []));
			}

			return {
				month: month.month,
				currency: month.currency,
				rows: new Map(month.rows.map((row) => [row.categoryId, row])),
				spending: spentByCategory(rows, allCategories),
			};
		}),
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
				budgetScope(deps.budgetOwnerId),
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

	const months = await setUpMonths(deps.db, { from: first }, deps.budgetOwnerId);
	const chain = await chainOf(deps, months, await treeCategories(deps.db));

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
async function setUpBudget(db: Db, month: IsoMonth, ownerId?: string | null) {
	const budget = await db
		.select()
		.from(budgets)
		.where(and(eq(budgets.month, month), budgetScope(ownerId)))
		.get();

	if (budget === undefined || budget.budgetedSpending === null) {
		throw new AppError("BUDGET_NOT_SET_UP", "Set this month's budget before its categories.");
	}

	return budget;
}

/** The current budget period in the household's time zone. */
export async function currentBudgetPeriod(deps: ServiceDeps) {
	const date = today(deps.timeZone);

	return { month: budgetMonthOf(date, await getMonthStartDay(deps.db)), today: date };
}

async function budgetMonths(deps: ServiceDeps) {
	const [startDay, oldest] = await Promise.all([getMonthStartDay(deps.db), oldestEntryDate(deps)]);
	const current = budgetMonthOf(today(deps.timeZone), startDay);

	return { startDay, current, bounds: budgetBounds(current, oldest, startDay) };
}

/** Saved slugs remain usable when the bounds move. */
async function budgetMonthAllowed(
	db: Db,
	month: IsoMonth,
	bounds: MonthBounds,
	ownerId?: string | null,
): Promise<boolean> {
	return (
		isBudgetMonth(month, bounds) ||
		(await db
			.select({ id: budgets.id })
			.from(budgets)
			.where(and(eq(budgets.month, month), budgetScope(ownerId)))
			.get()) !== undefined
	);
}

export async function isBudgetableMonth(deps: ServiceDeps, month: IsoMonth): Promise<boolean> {
	return isBudgetMonth(month, (await budgetMonths(deps)).bounds);
}

/**
 * A month's budget beside its actuals and suggestions. Never writes: a month
 * without a stored row is computed without creating one. What each category
 * received is computed again from the ledger as it stands, never taken from
 * the stored rollover amount, which only the next budget write refreshes. A month out of bounds is `NOT_FOUND`.
 */
export async function getBudget(
	deps: ServiceDeps,
	requestedMonth: IsoMonth | undefined,
): Promise<BudgetMonth> {
	const calendar = await budgetMonths(deps);
	const month = requestedMonth ?? calendar.current;
	const row = await deps.db
		.select()
		.from(budgets)
		.where(and(eq(budgets.month, month), budgetScope(deps.budgetOwnerId)))
		.get();

	if (row === undefined && !isBudgetMonth(month, calendar.bounds)) {
		throw notFound();
	}

	return readBudget(deps, calendar, month, row);
}

/** Sure's budget history, with only the target computed when nothing was saved. */
export async function getBudgetHistory(
	deps: ServiceDeps,
	requestedMonth: IsoMonth | undefined,
	priorMonths: number,
) {
	const calendar = await budgetMonths(deps);
	const month = requestedMonth ?? calendar.current;
	const earlier = Array.from({ length: priorMonths }, (_, index) =>
		shiftMonth(month, index - priorMonths),
	).filter((item) => isBudgetMonth(item, calendar.bounds));
	const includeTarget = isBudgetMonth(month, calendar.bounds);
	const candidates = includeTarget ? [...earlier, month] : earlier;
	const stored =
		candidates.length === 0
			? []
			: await deps.db
					.select()
					.from(budgets)
					.where(and(inArray(budgets.month, candidates), budgetScope(deps.budgetOwnerId)));
	const rows = new Map(stored.map((row) => [row.month, row]));
	const prior = earlier.filter((item) => rows.has(item));
	const months = includeTarget ? [...prior, month] : prior;

	return {
		currency: await getReportingCurrency(deps.db),
		months: await Promise.all(
			months.map(async (item) => readBudget(deps, calendar, item, rows.get(item))),
		),
		unavailable: earlier.length - prior.length,
	};
}

async function readBudget(
	deps: ServiceDeps,
	{ bounds, current, startDay }: Awaited<ReturnType<typeof budgetMonths>>,
	month: IsoMonth,
	row: typeof budgets.$inferSelect | undefined,
): Promise<BudgetMonth> {
	const [chainMonths, source] = await Promise.all([
		setUpMonths(deps.db, { to: month }, deps.budgetOwnerId),
		latestSetUpBefore(deps.db, month, deps.budgetOwnerId),
	]);
	const { startDate: from, endDate: to } = row ?? budgetPeriod(month, startDay);
	const periodStartDay = Number(from.slice(8));
	const [
		{ cashFlow, gross, rows, categories: allCategories, billReservations, accountIds },
		monthRows,
	] = await Promise.all([
		getCashFlowWithRows(deps, month, { from, to }).then(async (view) => ({
			...view,
			billReservations: await budgetBillReservations(deps, view.cashFlow),
		})),
		getCashFlowMonths(deps, periodStartDay),
	]);
	const statistics = statisticsOf(monthRows);
	const currentPeriod = budgetPeriod(current, startDay);
	const budgetedSpending = row?.budgetedSpending ?? null;
	const expectedIncome = row?.expectedIncome ?? null;
	// Partial budgets can hold category amounts before joining the rollover chain.
	const shown =
		row !== undefined && budgetedSpending === null
			? await storedRowsOf(deps.db, row.id)
			: new Map(
					chainMonths
						.find((item) => item.month === month)
						?.rows.map((item) => [item.categoryId, item]),
				);
	const carried = (await chainOf(deps, chainMonths, allCategories)).get(month);
	const sharedPersonal =
		typeof deps.budgetOwnerId === "string" && deps.budgetOwnerId !== deps.actor?.id;
	const readable = sharedPersonal
		? new Set(
				(await deps.db.select({ id: accounts.id }).from(accounts).where(accountScope(deps))).map(
					({ id }) => id,
				),
			)
		: null;
	const envelopes = budgetCategories({
		categories: allCategories,
		amounts: new Map([...shown].map(([id, item]) => [id, item.budgetedSpending])),
		rollover: new Map(
			[...shown].map(([id, item]) => [
				id,
				{
					enabled: item.rolloverEnabled,
					carried: carried?.get(id) ?? toMinorUnits(0),
				},
			]),
		),
		rows,
		statistics: statistics.categories,
		budgetedSpending: budgetedSpending === null ? null : toMinorUnits(budgetedSpending),
	});

	return {
		month,
		isCurrent: from === currentPeriod.startDate && to === currentPeriod.endDate,
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
		billReservations,
		// Sure's `estimated_spending` and `estimated_income`.
		suggested: {
			spending: statistics.family.expense.median,
			income: statistics.family.income.median,
		},
		...neighbours(month, bounds),
		bounds,
		leftOut: cashFlow.leftOut.filter(({ id }) => readable === null || readable.has(id)),
		canReadTransactions: accountIds.some((id) => readable === null || readable.has(id)),
	};
}

/**
 * Sets a month's planned spending and expected income, in the reporting
 * currency: creates the month's row on its first save, updates it after.
 * Under the write lock, so two saves of one month never both insert. A month
 * set up for the first time inherits each category's rollover switch
 * that is on in the latest earlier month set up, as Sure's
 * `inherited_rollover_flags`, through a row at 0.
 */
export async function saveBudget(
	deps: ServiceDeps,
	month: IsoMonth,
	input: BudgetInput,
): Promise<BudgetMonth> {
	const currency = await getReportingCurrency(deps.db);
	// Parsed before the write lock: checking text needs no database.
	const parsed = budgetSchema(currency).safeParse(input);

	if (!parsed.success) {
		throw validationError(parsed.error);
	}

	await deps.db.transaction(
		async (tx) => {
			await assertBudgetWrite(deps, tx);
			const { bounds, startDay } = await budgetMonths({ ...deps, db: tx });

			if (!(await budgetMonthAllowed(tx, month, bounds, deps.budgetOwnerId))) {
				throw notFound();
			}

			await writeTotals(tx, deps.budgetOwnerId ?? null, month, startDay, {
				currency,
				...parsed.data,
			});
			await refreshRollover(tx, deps);
		},
		{ behavior: "immediate" },
	);

	return getBudget(deps, month);
}

type BudgetTotals = {
	budgetedSpending: MinorUnits | undefined;
	expectedIncome: MinorUnits | undefined;
};

/**
 * `saveBudget`'s write, under the caller's write lock and in its bounds:
 * creates the month's row on its first save, updates it after, and gives a
 * month its inherited rollover switches when planned spending is first set.
 */
async function writeTotals(
	tx: Db,
	ownerId: string | null,
	month: IsoMonth,
	startDay: number,
	totals: BudgetTotals & { currency: CurrencyCode },
) {
	const before = await tx
		.select()
		.from(budgets)
		.where(and(eq(budgets.month, month), budgetScope(ownerId)))
		.get();

	if (
		before !== undefined &&
		totals.budgetedSpending === undefined &&
		totals.expectedIncome === undefined
	) {
		return before.id;
	}

	const now = Date.now();
	const amounts = {
		...totals,
		expectedIncome:
			totals.expectedIncome ??
			before?.expectedIncome ??
			(totals.budgetedSpending === undefined ? null : 0),
		updatedAt: now,
	};
	const budget = await tx
		.insert(budgets)
		.values({
			id: crypto.randomUUID(),
			ownerId,
			month,
			...budgetPeriod(month, startDay),
			...amounts,
			createdAt: now,
		})
		.onConflictDoUpdate(
			ownerId === null
				? { target: budgets.month, targetWhere: isNull(budgets.ownerId), set: amounts }
				: { target: [budgets.ownerId, budgets.month], set: amounts },
		)
		.returning({ id: budgets.id })
		.get();

	if (totals.budgetedSpending !== undefined && (before?.budgetedSpending ?? null) === null) {
		await inheritRollover(tx, month, budget.id, now, ownerId);
	}

	return budget.id;
}

/**
 * Sure's `inherited_rollover_flags`: a row at 0, rollover on, for each
 * category whose switch is on in the latest month set up before
 * `month`. Keep amounts saved by the assistant before the month was set up.
 */
async function inheritRollover(
	tx: Db,
	month: IsoMonth,
	budgetId: string,
	now: number,
	ownerId: string | null,
) {
	const source = await latestSetUpBefore(tx, month, ownerId);

	if (source === undefined) {
		return;
	}

	const inherited = await tx
		.select({ categoryId: budgetCategoryRows.categoryId })
		.from(budgetCategoryRows)
		.innerJoin(categories, eq(categories.id, budgetCategoryRows.categoryId))
		.where(
			and(eq(budgetCategoryRows.budgetId, source.id), eq(budgetCategoryRows.rolloverEnabled, true)),
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
			.onConflictDoUpdate({
				target: [budgetCategoryRows.budgetId, budgetCategoryRows.categoryId],
				set: { rolloverEnabled: true, updatedAt: now },
			});
	}
}

/**
 * Sets one category's amount in a month set up, as Sure's
 * `update_budgeted_spending!`: creates its row on the first save. A
 * subcategory's save also sets its parent to its children's amounts plus its
 * own reserve, creating the parent's row if needed, in the same transaction;
 * a parent keeps the amount entered until a child save recalculates it.
 * Answers the whole month, as `getBudget` does.
 */
export async function saveCategoryBudget(
	deps: ServiceDeps,
	month: IsoMonth,
	categoryId: string,
	input: BudgetCategoryInput,
): Promise<BudgetMonth> {
	const parsed = budgetCategorySchema(await getReportingCurrency(deps.db)).safeParse(input);

	if (!parsed.success) {
		throw validationError(parsed.error);
	}

	const amount = parsed.data.budgetedSpending;

	await deps.db.transaction(
		async (tx) => {
			await assertBudgetWrite(deps, tx);
			const { bounds } = await budgetMonths({ ...deps, db: tx });

			if (!(await budgetMonthAllowed(tx, month, bounds, deps.budgetOwnerId))) {
				throw notFound();
			}

			const budget = await setUpBudget(tx, month, deps.budgetOwnerId);
			const category = await tx
				.select()
				.from(categories)
				.where(eq(categories.id, categoryId))
				.get();

			if (category === undefined) {
				throw unknownCategory();
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
 * up: the typed amount, then the parent's rebuilt total for a child.
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
	// A shared sibling has zero stored, so this sums only ring-fenced amounts.
	const siblingsOf = async (parentId: string) => {
		const [children] = await tx
			.select({ total: sum(budgetCategoryRows.budgetedSpending).mapWith(Number) })
			.from(budgetCategoryRows)
			.innerJoin(categories, eq(categories.id, budgetCategoryRows.categoryId))
			.where(
				and(
					eq(budgetCategoryRows.budgetId, budgetId),
					eq(categories.parentId, parentId),
					ne(budgetCategoryRows.categoryId, category.id),
				),
			);

		return toMinorUnits(children?.total ?? 0);
	};

	if (category.parentId === null) {
		await write(category.id, amount);
	} else {
		const previousChild = await amountOf(category.id);

		await write(category.id, amount);
		await write(
			category.parentId,
			parentAfterChildSave({
				parent: await amountOf(category.parentId),
				siblings: await siblingsOf(category.parentId),
				previousChild,
				child: amount,
			}),
		);
	}

	return amount;
}

type BudgetUpdate = BudgetTotals & {
	categories: readonly { categoryId: string; budgeted: MinorUnits }[];
};

/** Sure's `UpdateBudget`: create the month if needed and apply the patch atomically. */
export async function updateBudget(
	deps: ServiceDeps,
	requestedMonth: IsoMonth | undefined,
	input: BudgetUpdate,
) {
	const currency = await getReportingCurrency(deps.db);
	const { budgetedSpending, expectedIncome, categories: categoryAmounts } = input;

	const { month: savedMonth, updated } = await deps.db
		.transaction(
			async (tx) => {
				await assertBudgetWrite(deps, tx);
				const { bounds, current, startDay } = await budgetMonths({ ...deps, db: tx });
				const month = requestedMonth ?? current;

				if (!isBudgetMonth(month, bounds)) {
					throw notFound();
				}

				const budgetId = await writeTotals(tx, deps.budgetOwnerId ?? null, month, startDay, {
					currency,
					budgetedSpending,
					expectedIncome,
				});
				const found = await tx
					.select({ id: categories.id, name: categories.name, parentId: categories.parentId })
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

					if (category === undefined) {
						throw unknownCategory();
					}

					return { category, amount: entry.budgeted };
				});
				// A parent amount given explicitly wins over the totals rebuilt by child saves.
				const ordered = [
					...writes.filter(({ category }) => category.parentId !== null),
					...writes.filter(({ category }) => category.parentId === null),
				];
				const saved = await ordered.reduce<
					Promise<{ name: string; budgetedSpending: MinorUnits }[]>
				>(async (previous, { category, amount }) => {
					const written = await previous;
					const savedAmount = await writeCategoryAmount(tx, budgetId, category, amount);
					written.push({ name: category.name, budgetedSpending: savedAmount });

					return written;
				}, Promise.resolve([]));

				await refreshRollover(tx, deps);

				return { month, updated: saved };
			},
			{ behavior: "immediate" },
		)
		.catch((error: unknown) => {
			const cause = error instanceof DrizzleQueryError ? error.cause : error;

			if (
				cause instanceof Error &&
				"code" in cause &&
				typeof cause.code === "string" &&
				cause.code.startsWith("SQLITE_CONSTRAINT")
			) {
				throw new AppError("VALIDATION_ERROR", "The budget row could not be saved.");
			}

			throw error;
		});

	return { budget: await getBudget(deps, savedMonth), updated };
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
	const currency = await getReportingCurrency(deps.db);

	const copiedFrom = await deps.db.transaction(
		async (tx) => {
			await assertBudgetWrite(deps, tx);
			const { bounds, startDay } = await budgetMonths({ ...deps, db: tx });

			if (!(await budgetMonthAllowed(tx, month, bounds, deps.budgetOwnerId))) {
				throw notFound();
			}

			const target = await tx
				.select()
				.from(budgets)
				.where(and(eq(budgets.month, month), budgetScope(deps.budgetOwnerId)))
				.get();

			if (target !== undefined && target.budgetedSpending !== null) {
				throw new AppError("BUDGET_ALREADY_SET_UP", "This month's budget is already set up.");
			}

			const source = await latestSetUpBefore(tx, month, deps.budgetOwnerId);

			if (source === undefined) {
				throw new AppError("NOT_FOUND", "No earlier month is set up to copy from.");
			}

			const sourceRows = await storedRowsOf(tx, source.id);
			const allCategories = await tx.select({ id: categories.id }).from(categories);
			const now = Date.now();
			const amounts = {
				currency,
				budgetedSpending: source.budgetedSpending,
				expectedIncome: source.expectedIncome,
				updatedAt: now,
			};
			const budget = await tx
				.insert(budgets)
				.values({
					id: crypto.randomUUID(),
					ownerId: deps.budgetOwnerId ?? null,
					month,
					...budgetPeriod(month, startDay),
					...amounts,
					createdAt: now,
				})
				.onConflictDoUpdate(
					typeof deps.budgetOwnerId !== "string"
						? { target: budgets.month, targetWhere: isNull(budgets.ownerId), set: amounts }
						: { target: [budgets.ownerId, budgets.month], set: amounts },
				)
				.returning({ id: budgets.id })
				.get();
			const copied = [...copiedRows({ categories: allCategories, source: sourceRows })];

			// Copy replaces the whole plan, including amounts saved before setup.
			if (target !== undefined) {
				await tx.delete(budgetCategoryRows).where(eq(budgetCategoryRows.budgetId, budget.id));
			}

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

const moveRefusalMessages = {
	BUDGET_MOVE_SAME_CATEGORY: "Choose a different destination category.",
	BUDGET_MOVE_PARENT_CHILD: "Money cannot move between a parent category and its child.",
	BUDGET_MOVE_INSUFFICIENT_FUNDS: "The source category cannot give that much.",
};

/**
 * Sure's `BudgetCategory.move_allocation!`: moves an amount from one
 * category to another in a month set up, both sides in one transaction, as
 * `moveAllocation` computes them. The month in the route scopes both
 * categories, so a move between two budgets cannot be represented.
 */
export async function moveCategoryBudget(
	deps: ServiceDeps,
	month: IsoMonth,
	input: BudgetMoveInput,
): Promise<BudgetMonth> {
	const { fromCategoryId, toCategoryId } = input;
	const amount =
		input.amount.trim() === ""
			? toMinorUnits(0)
			: parseAmount(input.amount, await getReportingCurrency(deps.db));

	if (amount === null) {
		throw new AppError("VALIDATION_ERROR", "The request is invalid.", [
			{ path: "amount", code: "invalid_amount" },
		]);
	}

	if (amount <= 0) {
		throw new AppError("BUDGET_MOVE_NON_POSITIVE_AMOUNT", "Enter an amount greater than zero.");
	}

	await deps.db.transaction(
		async (tx) => {
			await assertBudgetWrite(deps, tx);
			const { bounds } = await budgetMonths({ ...deps, db: tx });

			if (!(await budgetMonthAllowed(tx, month, bounds, deps.budgetOwnerId))) {
				throw notFound();
			}

			const budget = await setUpBudget(tx, month, deps.budgetOwnerId);
			const allCategories = await tx
				.select({ id: categories.id, parentId: categories.parentId })
				.from(categories);
			const from = allCategories.find((category) => category.id === fromCategoryId);
			const to = allCategories.find((category) => category.id === toCategoryId);

			if (fromCategoryId === UNCATEGORISED || toCategoryId === UNCATEGORISED) {
				throw new AppError("BUDGET_MOVE_UNCATEGORISED", "Uncategorised money cannot be moved.");
			}

			if (from === undefined || to === undefined) {
				throw unknownCategory();
			}

			const stored = await storedRowsOf(tx, budget.id);
			const result = moveAllocation({
				categories: allCategories,
				amounts: new Map([...stored].map(([id, row]) => [id, row.budgetedSpending])),
				from,
				to,
				amount,
			});

			if ("refusal" in result) {
				throw new AppError(result.refusal, moveRefusalMessages[result.refusal]);
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
 * Sure's rollover switch on one category: sets it in a month set up
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
			await assertBudgetWrite(deps, tx);
			const { bounds } = await budgetMonths({ ...deps, db: tx });

			if (!(await budgetMonthAllowed(tx, month, bounds, deps.budgetOwnerId))) {
				throw notFound();
			}

			const budget = await setUpBudget(tx, month, deps.budgetOwnerId);
			const category = await tx
				.select({ id: categories.id })
				.from(categories)
				.where(eq(categories.id, categoryId))
				.get();

			if (category === undefined) {
				throw unknownCategory();
			}

			const later = await tx
				.select({ id: budgets.id })
				.from(budgets)
				.where(
					and(
						budgetScope(deps.budgetOwnerId),
						gt(budgets.month, month),
						isNotNull(budgets.budgetedSpending),
					),
				);
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
