import type { BudgetActuals, SpendingSegment } from "../domain/budgets/actuals.ts";
import type { MonthBounds } from "../domain/budgets/months.ts";
import type { IsoMonth } from "../domain/dates.ts";
import type { BudgetInput } from "../schemas/budgets.ts";
import type { ServiceDeps } from "./deps.ts";
import type { CashFlow } from "./reports.ts";

import { eq } from "drizzle-orm";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { budgets } from "@archant/data/schema/budgets";

import { actualsOf, spendingSegments, suggestions } from "../domain/budgets/actuals.ts";
import { budgetBounds, isBudgetMonth, neighbours } from "../domain/budgets/months.ts";
import { today } from "../domain/dates.ts";
import { AppError } from "../lib/errors.ts";
import { validationError } from "../lib/zod-error.ts";
import { budgetSchema } from "../schemas/budgets.ts";
import { oldestEntryDate } from "./ledger/queries.ts";
import { getCashFlow, getCashFlowHistory } from "./reports.ts";
import { getReportingCurrency } from "./settings.ts";

/** A month's budget as the page shows it, whether set up or not. */
export type BudgetMonth = {
	month: IsoMonth;
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

	const [row, cashFlow, history] = await Promise.all([
		deps.db.select().from(budgets).where(eq(budgets.month, month)).get(),
		getCashFlow(deps, month),
		getCashFlowHistory(deps, month < current ? month : current),
	]);
	const budgetedSpending = row?.budgetedSpending ?? null;
	const expectedIncome = row?.expectedIncome ?? null;

	return {
		month,
		currency: cashFlow.currency,
		setUp: budgetedSpending !== null,
		budgetedSpending: budgetedSpending === null ? null : toMinorUnits(budgetedSpending),
		expectedIncome: expectedIncome === null ? null : toMinorUnits(expectedIncome),
		actual: actualsOf(cashFlow),
		segments: spendingSegments(cashFlow.lines.expense),
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
