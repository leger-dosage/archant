import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { ACCOUNT_PERMISSIONS, BUDGET_PERMISSIONS } from "../account-sharing.ts";
import { accounts } from "./accounts.ts";
import { users } from "./auth.ts";
import { inList } from "./check.ts";

export const accountShares = sqliteTable(
	"account_shares",
	{
		accountId: text("account_id")
			.notNull()
			.references(() => accounts.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		permission: text("permission", { enum: ACCOUNT_PERMISSIONS }).notNull(),
		includeInFinances: integer("include_in_finances", { mode: "boolean" }).notNull().default(true),
	},
	(table) => [
		primaryKey({ columns: [table.accountId, table.userId] }),
		index("account_shares_user").on(table.userId),
		check(
			"account_shares_permission_check",
			sql`${table.permission} in ${inList(ACCOUNT_PERMISSIONS)}`,
		),
	],
);

export const budgetShares = sqliteTable(
	"budget_shares",
	{
		ownerId: text("owner_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		viewerId: text("viewer_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		permission: text("permission", { enum: BUDGET_PERMISSIONS }).notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.ownerId, table.viewerId] }),
		index("budget_shares_viewer").on(table.viewerId),
		check(
			"budget_shares_permission_check",
			sql`${table.permission} in ${inList(BUDGET_PERMISSIONS)}`,
		),
		check("budget_shares_distinct_users", sql`${table.ownerId} != ${table.viewerId}`),
	],
);
