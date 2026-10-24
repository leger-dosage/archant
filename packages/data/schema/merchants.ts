import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { sampleCategoryColor } from "../category-presets.ts";

/**
 * One shop the bank spells many ways. The user names some; a bank sync
 * creates the others from a line's counterparty, found again by name. No
 * source column: Sure's `ProviderMerchant` is shared between families, and
 * Archant holds one household, so a bank's merchant is one of its merchants.
 */
export const merchants = sqliteTable(
	"merchants",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		// Sure's `FamilyMerchant::COLORS` are `Category::COLORS`; an insert
		// without one, a bank sync's or an import's, draws one as Sure's
		// `set_default_color`.
		color: text("color")
			.notNull()
			.$defaultFn(() => sampleCategoryColor()),
		// Kept, never fetched: Sure turns it into a Brandfetch logo, which the
		// Content-Security-Policy refuses.
		websiteUrl: text("website_url"),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		// SQLite's `lower` folds ASCII only; the service also compares names with
		// a locale-aware fold, so « épicerie » meets « Épicerie » before this does.
		uniqueIndex("merchants_name_unique").on(sql`lower(${table.name})`),
	],
);
