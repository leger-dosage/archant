import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { entries } from "./entries.ts";

/**
 * Fields a user edit can lock (AD-10). Grows with the columns later epics add,
 * so a rule or a provider knows by name what it must not overwrite.
 */
export const LOCKABLE_FIELDS = ["date", "amount", "label", "notes", "excluded"] as const;

export type LockableField = (typeof LOCKABLE_FIELDS)[number];

/**
 * The transaction-only columns of an entry whose `kind` is `transaction`, as
 * in Sure's delegated types (AD-8). The date and the amount stay on `entries`,
 * where the balance computation reads them for transactions and valuations alike.
 */
export const transactions = sqliteTable("transactions", {
	// Restrict, not cascade: only the ledger deletes an entry, and it removes
	// this row first. A bypass fails instead of leaving the entry half gone.
	entryId: text("entry_id")
		.primaryKey()
		.references(() => entries.id, { onDelete: "restrict" }),
	label: text("label").notNull(),
	notes: text("notes"),
	// Kept out of future reports (AD-9), never out of the account's balance:
	// the money did move.
	excluded: integer("excluded", { mode: "boolean" }).notNull().default(false),
	// Set when an import found two entries equally near this line and created
	// it rather than guess; the merge action arrives with a later story.
	possibleDuplicate: integer("possible_duplicate", { mode: "boolean" }).notNull().default(false),
	// Written only by `origin: "user"` ledger calls; read by every later writer.
	lockedFields: text("locked_fields", { mode: "json" })
		.$type<LockableField[]>()
		.notNull()
		.default(sql`'[]'`),
});
