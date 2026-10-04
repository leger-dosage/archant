import type { CategoryColor, CategoryIcon } from "../category-presets.ts";
import type { GoalKind, GoalState } from "../goals.ts";

import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { GOAL_KINDS, GOAL_STATES } from "../goals.ts";
import { accounts } from "./accounts.ts";
import { inList } from "./check.ts";

/**
 * Sure's `Goal`: a target the household saves toward, filled by its linked
 * accounts' balances rather than by transactions. Nothing here is derived:
 * what is saved, the monthly amount and the status are computed when read.
 * Amounts are minor units of `currency`, the first linked account's on
 * creation, which never changes after.
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
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		check("goals_target_amount_check", sql`${table.targetAmount} > 0`),
		check("goals_state_check", sql`${table.state} in ${inList(GOAL_STATES)}`),
		check("goals_kind_check", sql`${table.kind} in ${inList(GOAL_KINDS)}`),
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
