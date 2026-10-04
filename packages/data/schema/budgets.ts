import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { categories } from "./categories.ts";

/**
 * Sure's `Budget`, one row per calendar month, created on the first save:
 * reading a month writes nothing. A month is set up when `budgeted_spending`
 * is not null, as Sure's `initialized?`. Amounts are minor units of
 * `currency`, the reporting currency when the row was saved.
 */
export const budgets = sqliteTable(
	"budgets",
	{
		id: text("id").primaryKey(),
		/** `YYYY-MM`. */
		month: text("month").notNull(),
		currency: text("currency").notNull(),
		budgetedSpending: integer("budgeted_spending"),
		expectedIncome: integer("expected_income"),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		uniqueIndex("budgets_month_unique").on(table.month),
		// A null amount passes: a comparison with null is not false.
		check(
			"budgets_amounts_check",
			sql`${table.budgetedSpending} >= 0 and ${table.expectedIncome} >= 0`,
		),
	],
);

/**
 * Sure's `BudgetCategory`: one expense category's amount in one month's
 * budget, in minor units of that budget's currency. Written on the first save
 * of that amount, never on read: a category without a row has 0. A parent's
 * amount is its total, its ring-fenced children's amounts plus its own
 * reserve. Deleted with its budget or its category, as Sure's
 * `dependent: :destroy`, so a merge drops the merged category's rows too.
 * `rollover_enabled` carries what the month leaves into the next month set
 * up; `rolled_over_amount` is what came in, as the last budget write
 * computed it: a read computes the chain again rather than trusting it.
 */
export const budgetCategories = sqliteTable(
	"budget_categories",
	{
		id: text("id").primaryKey(),
		budgetId: text("budget_id")
			.notNull()
			.references(() => budgets.id, { onDelete: "cascade" }),
		categoryId: text("category_id")
			.notNull()
			.references(() => categories.id, { onDelete: "cascade" }),
		budgetedSpending: integer("budgeted_spending").notNull(),
		rolloverEnabled: integer("rollover_enabled", { mode: "boolean" }).notNull().default(false),
		rolledOverAmount: integer("rolled_over_amount").notNull().default(0),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		uniqueIndex("budget_categories_budget_category_unique").on(table.budgetId, table.categoryId),
		// A category's delete looks its rows up to cascade.
		index("budget_categories_category").on(table.categoryId),
		check("budget_categories_amount_check", sql`${table.budgetedSpending} >= 0`),
		// Only a surplus carries: an overspent month stops where it happened.
		check("budget_categories_rolled_over_check", sql`${table.rolledOverAmount} >= 0`),
	],
);
