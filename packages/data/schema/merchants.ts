import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const MERCHANT_NAME_MAX_LENGTH = 60;

/**
 * One shop the bank spells many ways. Names come from the user only for now;
 * a merchant created from bank data will need a source column, as Sure's
 * `ProviderMerchant` has.
 */
export const merchants = sqliteTable(
	"merchants",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		// SQLite's `lower` folds ASCII only; the service also compares names with
		// a locale-aware fold, so « épicerie » meets « Épicerie » before this does.
		uniqueIndex("merchants_name_unique").on(sql`lower(${table.name})`),
	],
);
