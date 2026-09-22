import type { CsvMapping } from "./imports.ts";

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { accounts } from "./accounts.ts";

/**
 * The CSV mapping an account's last confirmed CSV import used, so the next
 * file from the same bank opens straight on its preview. Deleting the
 * account deletes it: it holds nothing but column choices.
 */
export const importMappings = sqliteTable("import_mappings", {
	accountId: text("account_id")
		.primaryKey()
		.references(() => accounts.id, { onDelete: "cascade" }),
	mapping: text("mapping", { mode: "json" }).$type<CsvMapping>().notNull(),
	updatedAt: integer("updated_at").notNull(),
});
