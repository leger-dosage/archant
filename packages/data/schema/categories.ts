import type { CategoryIcon } from "../category-presets.ts";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { inList } from "./check.ts";

/**
 * Groups the display only (AD-9): a category total is the signed sum of its
 * transactions, and nothing flips a sign on the kind.
 */
export const CATEGORY_KINDS = ["income", "expense"] as const;

export type CategoryKind = (typeof CATEGORY_KINDS)[number];

/**
 * Two levels at most, as in Sure: a child's parent is a top-level category.
 * The service enforces the depth and copies the parent's kind and colour onto
 * its children; the database only holds the reference.
 */
export const categories = sqliteTable(
	"categories",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		kind: text("kind").$type<CategoryKind>().notNull(),
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
		check("categories_kind_check", sql`${table.kind} in ${inList(CATEGORY_KINDS)}`),
		// SQLite's `lower` folds ASCII only; the service also compares names with
		// a locale-aware fold, so « épargne » meets « Épargne » before this does.
		uniqueIndex("categories_name_unique").on(sql`lower(${table.name})`),
		index("categories_parent").on(table.parentId),
	],
);
