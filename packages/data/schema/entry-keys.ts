import { sql } from "drizzle-orm";
import { check, index, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { accounts } from "./accounts.ts";
import { inList } from "./check.ts";
import { entries } from "./entries.ts";
import { FILE_SOURCE_IDS, imports } from "./imports.ts";

/**
 * The keys under which a source recognises an entry it already wrote (AD-7):
 * `fp:<sha256>` for every line, plus `ext:<id>` when the source has its own
 * id. Written at ingest and never recomputed, so editing an imported
 * transaction never breaks its recognition. Manual entries have none. Epic 10
 * adds `connection_id`.
 */
export const entryKeys = sqliteTable(
	"entry_keys",
	{
		// Restrict, not cascade: the ledger deletes the keys before the entry.
		entryId: text("entry_id")
			.notNull()
			.references(() => entries.id, { onDelete: "restrict" }),
		accountId: text("account_id")
			.notNull()
			.references(() => accounts.id, { onDelete: "restrict" }),
		source: text("source").$type<(typeof FILE_SOURCE_IDS)[number]>().notNull(),
		key: text("key").notNull(),
		importId: text("import_id").references(() => imports.id, { onDelete: "restrict" }),
	},
	(table) => [
		// One entry per key and source on an account: re-importing never duplicates.
		primaryKey({ columns: [table.accountId, table.source, table.key] }),
		check("entry_keys_source_check", sql`${table.source} in ${inList(FILE_SOURCE_IDS)}`),
		index("entry_keys_entry").on(table.entryId),
		index("entry_keys_import").on(table.importId),
	],
);
