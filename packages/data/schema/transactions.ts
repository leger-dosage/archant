import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { type CategoryOrigin, CATEGORY_ORIGINS, categories } from "./categories.ts";
import { inList } from "./check.ts";
import { entries } from "./entries.ts";

/**
 * Fields a user edit can lock (AD-10). Grows with the columns later epics add,
 * so a rule or a provider knows by name what it must not overwrite.
 */
export const LOCKABLE_FIELDS = [
	"date",
	"amount",
	"label",
	"notes",
	"excluded",
	"category",
] as const;

export type LockableField = (typeof LOCKABLE_FIELDS)[number];

/**
 * The transaction-only columns of an entry whose `kind` is `transaction`, as
 * in Sure's delegated types (AD-8). The date and the amount stay on `entries`,
 * where the balance computation reads them for transactions and valuations alike.
 */
export const transactions = sqliteTable(
	"transactions",
	{
		// Restrict, not cascade: only the ledger deletes an entry, and it removes
		// this row first. A bypass fails instead of leaving the entry half gone.
		entryId: text("entry_id")
			.primaryKey()
			.references(() => entries.id, { onDelete: "restrict" }),
		label: text("label").notNull(),
		notes: text("notes"),
		// A cheque or QIF `N` number the bank printed; not lockable, no source edits it.
		reference: text("reference"),
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
		// Null is « Sans catégorie ». Restrict: deleting a category goes through the
		// service, which moves its transactions first, so a bypass fails instead of
		// silently uncategorising them.
		categoryId: text("category_id").references(() => categories.id, { onDelete: "restrict" }),
		// Who set `categoryId`; the lock itself lives in `lockedFields`, so a
		// merge can move a category without deciding who owns it.
		categoryOrigin: text("category_origin").$type<CategoryOrigin>(),
	},
	(table) => [
		// Every category delete and merge, and the list's filter, look rows up by it.
		index("transactions_category").on(table.categoryId),
		check(
			"transactions_category_origin_check",
			sql`${table.categoryOrigin} in ${inList(CATEGORY_ORIGINS)}`,
		),
		check(
			"transactions_category_origin_set_check",
			sql`(${table.categoryId} is null) = (${table.categoryOrigin} is null)`,
		),
	],
);
