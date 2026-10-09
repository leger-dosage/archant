import type { TransferKind, TransferStatus } from "../transfer-kinds.ts";

import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { TRANSFER_KINDS, TRANSFER_STATUSES } from "../transfer-kinds.ts";
import { inList } from "./check.ts";
import { transactions } from "./transactions.ts";

/**
 * Two transactions of the household's own accounts that are one movement of
 * money, as in Sure: never a flag on one side. Only the ledger writes it.
 */
export const transfers = sqliteTable(
	"transfers",
	{
		id: text("id").primaryKey(),
		// Restrict, not cascade: every ledger path that deletes a transaction
		// deletes its transfer first, so the other side is left standard on purpose.
		// The negative side: money leaves this account, asset or liability alike.
		outflowTransactionId: text("outflow_transaction_id")
			.notNull()
			.references(() => transactions.entryId, { onDelete: "restrict" }),
		inflowTransactionId: text("inflow_transaction_id")
			.notNull()
			.references(() => transactions.entryId, { onDelete: "restrict" }),
		kind: text("kind").$type<TransferKind>().notNull(),
		// Every transfer made before statuses existed reads `pending`: no column
		// said which ones the matcher had made, and the owner confirms them.
		status: text("status").$type<TransferStatus>().notNull().default("pending"),
		createdAt: integer("created_at").notNull(),
	},
	(table) => [
		// A transaction sits in one transfer at most. The list also joins on these
		// two indexes to show each side its counterpart.
		uniqueIndex("transfers_outflow_unique").on(table.outflowTransactionId),
		uniqueIndex("transfers_inflow_unique").on(table.inflowTransactionId),
		check(
			"transfers_distinct_sides_check",
			sql`${table.outflowTransactionId} <> ${table.inflowTransactionId}`,
		),
		check("transfers_kind_check", sql`${table.kind} in ${inList(TRANSFER_KINDS)}`),
		check("transfers_status_check", sql`${table.status} in ${inList(TRANSFER_STATUSES)}`),
	],
);
