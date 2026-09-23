import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const TAG_NAME_MAX_LENGTH = 60;

/**
 * A mark that follows a trip or a project across categories. No colour, as in
 * Sure the tag's name is all a row shows.
 */
export const tags = sqliteTable(
	"tags",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		// SQLite's `lower` folds ASCII only; the service also compares names with
		// a locale-aware fold, so « été » meets « Été » before this does.
		uniqueIndex("tags_name_unique").on(sql`lower(${table.name})`),
	],
);
