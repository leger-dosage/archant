import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Instance-wide values, one row per key. A row can also be a one-time claim:
 * inserting `setup_completed_at` is atomic through the primary key, which is
 * what lets exactly one first-launch setup through (AD-12, AD-13).
 */
export const settings = sqliteTable("settings", {
	key: text("key").primaryKey(),
	value: text("value").notNull(),
	updatedAt: integer("updated_at").notNull(),
});
