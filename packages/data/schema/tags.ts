import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { sampleCategoryColor } from "../category-presets.ts";

/** A mark that follows a trip or a project across categories, in its colour, as Sure's `Tag`. */
export const tags = sqliteTable(
	"tags",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		// Sure's `Tag::COLORS` are `Category::COLORS`; an insert without one,
		// an import's or a test's, draws one as Sure's `COLORS.sample`.
		color: text("color")
			.notNull()
			.$defaultFn(() => sampleCategoryColor()),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		// SQLite's `lower` folds ASCII only; the service also compares names with
		// a locale-aware fold, so « été » meets « Été » before this does.
		uniqueIndex("tags_name_unique").on(sql`lower(${table.name})`),
	],
);
