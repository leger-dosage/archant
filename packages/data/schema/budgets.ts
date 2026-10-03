import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
