import type { CategoryColor, CategoryIcon } from "../category-presets.ts";
import type { GoalKind, GoalState, GoalTargetMode } from "../goals.ts";

import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { GOAL_KINDS, GOAL_STATES, GOAL_TARGET_MODES, GOAL_TARGET_MONTHS_MAX } from "../goals.ts";
import { accounts } from "./accounts.ts";
import { inList } from "./check.ts";

/**
 * Sure's `Goal`: a target the household saves toward, filled by its linked
 * accounts' balances rather than by transactions. Nothing here is derived:
 * what is saved, the monthly amount and the status are computed when read.
 * Amounts are minor units of `currency`, the first linked account's on
 * creation, which never changes after. A reserve sized in months of expenses
 * reads its target from the median monthly expenses when it can, and falls
 * back on `target_amount`, the product last computed when it was saved.
 */
export const goals = sqliteTable(
	"goals",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		targetAmount: integer("target_amount").notNull(),
		currency: text("currency").notNull(),
		/** `YYYY-MM-DD`; `null` for a goal without a date. */
		targetDate: text("target_date"),
		// Category swatches and icons, as Sure takes `Category::COLORS`. Checked
		// by the API, not here, as a category's: a swatch added later needs no
		// rebuilt table.
		color: text("color").$type<CategoryColor>().notNull(),
		icon: text("icon").$type<CategoryIcon>().notNull(),
		notes: text("notes"),
		state: text("state").$type<GoalState>().notNull().default("active"),
		kind: text("kind").$type<GoalKind>().notNull().default("one_off"),
		targetMode: text("target_mode").$type<GoalTargetMode>().notNull().default("fixed"),
		/** How many months of expenses a reserve holds; set in that mode only. */
		targetMonths: integer("target_months"),
		/**
		 * What the goal had saved when it was completed, in minor units, and
		 * when, in epoch milliseconds, as Sure's: a closed goal reports what it
		 * reached, not what its accounts hold since. Kept when it is archived,
		 * cleared when it becomes active again.
		 */
		completedAmount: integer("completed_amount"),
		completedAt: integer("completed_at"),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		check("goals_target_amount_check", sql`${table.targetAmount} > 0`),
		check("goals_state_check", sql`${table.state} in ${inList(GOAL_STATES)}`),
		check("goals_kind_check", sql`${table.kind} in ${inList(GOAL_KINDS)}`),
		check("goals_target_mode_check", sql`${table.targetMode} in ${inList(GOAL_TARGET_MODES)}`),
		check(
			"goals_target_months_check",
			sql`(${table.targetMode} = 'months_of_expenses') = (${table.targetMonths} is not null)`,
		),
		// A null count passes: a comparison with null is not false.
		check(
			"goals_target_months_range_check",
			sql`${table.targetMonths} between 1 and ${sql.raw(String(GOAL_TARGET_MONTHS_MAX))}`,
		),
		// Sure's `months_requires_maintained`.
		check(
			"goals_target_mode_kind_check",
			sql`${table.targetMode} = 'fixed' or ${table.kind} = 'maintained'`,
		),
		// Sure's `clear_target_date_for_maintained`: a reserve is kept, not reached by a day.
		check(
			"goals_reserve_date_check",
			sql`${table.kind} = 'one_off' or ${table.targetDate} is null`,
		),
		check(
			"goals_completed_check",
			sql`(${table.completedAmount} is null) = (${table.completedAt} is null)`,
		),
	],
);

/**
 * Sure's `GoalAccount`: one account backing one goal, with its whole
 * balance when `allocated_amount` is null, else a fixed amount in minor
 * units of the goal's currency. Deleted with its goal, and with its account,
 * which only the ledger deletes (AD-2): the account's row takes its links.
 */
export const goalAccounts = sqliteTable(
	"goal_accounts",
	{
		goalId: text("goal_id")
			.notNull()
			.references(() => goals.id, { onDelete: "cascade" }),
		accountId: text("account_id")
			.notNull()
			.references(() => accounts.id, { onDelete: "cascade" }),
		allocatedAmount: integer("allocated_amount"),
	},
	(table) => [
		primaryKey({ columns: [table.goalId, table.accountId] }),
		// An account's delete looks its links up to cascade.
		index("goal_accounts_account").on(table.accountId),
		// A null amount passes: a comparison with null is not false.
		check("goal_accounts_allocated_amount_check", sql`${table.allocatedAmount} >= 0`),
	],
);
