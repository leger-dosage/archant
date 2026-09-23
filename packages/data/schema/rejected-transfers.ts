import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { transactions } from "./transactions.ts";

/**
 * A pair of transactions the user refused as one transfer, so no candidate
 * search, by hand or automatic, offers it again. Only the ledger writes it.
 */
export const rejectedTransfers = sqliteTable(
	"rejected_transfers",
	{
		id: text("id").primaryKey(),
		// Restrict, not cascade, as on `transfers`: every ledger path that deletes
		// a transaction deletes its rejected pairs first.
		outflowTransactionId: text("outflow_transaction_id")
			.notNull()
			.references(() => transactions.entryId, { onDelete: "restrict" }),
		inflowTransactionId: text("inflow_transaction_id")
			.notNull()
			.references(() => transactions.entryId, { onDelete: "restrict" }),
		createdAt: integer("created_at").notNull(),
	},
	(table) => [
		uniqueIndex("rejected_transfers_pair_unique").on(
			table.outflowTransactionId,
			table.inflowTransactionId,
		),
		// The pair index serves a lookup by outflow; deleting an inflow side needs its own.
		index("rejected_transfers_inflow").on(table.inflowTransactionId),
		check(
			"rejected_transfers_distinct_sides_check",
			sql`${table.outflowTransactionId} <> ${table.inflowTransactionId}`,
		),
	],
);
