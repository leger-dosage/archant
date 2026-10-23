import type { CategoryIcon } from "../category-presets.ts";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Who set a transaction's category (AD-10). `user` goes with a lock; a rule or
 * the provider only writes a category nobody locked.
 */
export const CATEGORY_ORIGINS = ["user", "rule", "provider"] as const;

export type CategoryOrigin = (typeof CATEGORY_ORIGINS)[number];

/**
 * Two levels at most, as in Sure: a child's parent is a top-level category.
 * The service enforces the depth and copies the parent's colour onto its
 * children; the database only holds the reference. No income or expense kind,
 * as Sure since #1160: a line's side is its sign (AD-9).
 */
export const categories = sqliteTable(
	"categories",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		color: text("color").notNull(),
		icon: text("icon").$type<CategoryIcon>().notNull(),
		// Restrict, not cascade or set null: deleting a parent goes through the
		// service, which lifts its children to the top level first.
		parentId: text("parent_id").references((): AnySQLiteColumn => categories.id, {
			onDelete: "restrict",
		}),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		// SQLite's `lower` folds ASCII only; the service also compares names with
		// a locale-aware fold, so « épargne » meets « Épargne » before this does.
		uniqueIndex("categories_name_unique").on(sql`lower(${table.name})`),
		index("categories_parent").on(table.parentId),
	],
);
