import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { accounts } from "./accounts.ts";

/**
 * One row per account and day, the stored balance of AD-5: an asset's value or
 * a liability's amount owed. Derived from `entries`, rewritten by the ledger,
 * read only through `balanceOn`.
 */
export const balances = sqliteTable(
	"balances",
	{
		accountId: text("account_id")
			.notNull()
			.references(() => accounts.id, { onDelete: "restrict" }),
		date: text("date").notNull(),
		balance: integer("balance").notNull(),
		currency: text("currency").notNull(),
	},
	(table) => [primaryKey({ columns: [table.accountId, table.date] })],
);
