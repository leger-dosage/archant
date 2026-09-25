import type { BankConnectorId } from "./bank-connections.ts";

import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { accounts } from "./accounts.ts";
import { BANK_CONNECTOR_IDS, bankConnections } from "./bank-connections.ts";
import { inList } from "./check.ts";
import { entries } from "./entries.ts";
import { FILE_SOURCE_IDS, imports } from "./imports.ts";

/** Every source that writes keys: a file connector or a bank connector. */
export const ENTRY_KEY_SOURCES = [...FILE_SOURCE_IDS, ...BANK_CONNECTOR_IDS] as const;

export type EntryKeySource = (typeof ENTRY_KEY_SOURCES)[number];

/**
 * The keys under which a source recognises an entry it already wrote (AD-7):
 * `fp:<sha256>` for every line, plus `ext:<id>` when the source has its own
 * id. Written at ingest and never recomputed, so editing an imported
 * transaction never breaks its recognition. Manual entries have none. A key
 * written by a bank sync carries the connection it came from instead of an
 * import.
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
		source: text("source").$type<EntryKeySource>().notNull(),
		key: text("key").notNull(),
		importId: text("import_id").references(() => imports.id, { onDelete: "restrict" }),
		// Set null, not cascade: the key keeps recognising the line after the
		// connection goes, so a reconnection never duplicates history.
		connectionId: text("connection_id").references(() => bankConnections.id, {
			onDelete: "set null",
		}),
	},
	(table) => [
		// One entry per key and source on an account: re-importing never duplicates.
		primaryKey({ columns: [table.accountId, table.source, table.key] }),
		check("entry_keys_source_check", sql`${table.source} in ${inList(ENTRY_KEY_SOURCES)}`),
		index("entry_keys_entry").on(table.entryId),
		index("entry_keys_import").on(table.importId),
		// Deleting a connection sets its keys' `connection_id` to null: without
		// the index, every deletion scans the whole table.
		index("entry_keys_connection").on(table.connectionId),
	],
);

/**
 * The bank keys of an entry the user deleted, so a sync, which rereads the
 * last week, never brings it back. File keys are not kept: re-importing a
 * file is the user asking for its lines again. Nothing lifts a tombstone.
 */
export const deletedEntryKeys = sqliteTable(
	"deleted_entry_keys",
	{
		// Restrict, not cascade: the ledger deletes the tombstones before the account.
		accountId: text("account_id")
			.notNull()
			.references(() => accounts.id, { onDelete: "restrict" }),
		source: text("source").$type<BankConnectorId>().notNull(),
		key: text("key").notNull(),
		deletedAt: integer("deleted_at").notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.accountId, table.source, table.key] }),
		check("deleted_entry_keys_source_check", sql`${table.source} in ${inList(BANK_CONNECTOR_IDS)}`),
	],
);
