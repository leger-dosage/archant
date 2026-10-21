import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { transactions } from "./transactions.ts";
import { transfers } from "./transfers.ts";

/**
 * Which transactions are a transfer's fees, Sure's `transactions.transfer_id`:
 * undoing or refusing the transfer deletes them (AD-11). A table of its own,
 * as `transactions` cannot reference `transfers`, which references it.
 */
export const transferFees = sqliteTable(
	"transfer_fees",
	{
		// Cascade, unlike taggings: the link carries no money, and a path that
		// deletes a transfer alone, a side deleted or an import reverted, leaves
		// its fees standard lines rather than fail.
		transactionId: text("transaction_id")
			.primaryKey()
			.references(() => transactions.entryId, { onDelete: "cascade" }),
		transferId: text("transfer_id")
			.notNull()
			.references(() => transfers.id, { onDelete: "cascade" }),
	},
	(table) => [
		// Undoing a transfer finds its fees by it.
		index("transfer_fees_transfer").on(table.transferId),
	],
);
