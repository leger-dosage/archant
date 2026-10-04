import type { MinorUnits } from "../money.ts";

import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { accounts } from "./accounts.ts";

/**
 * One row per account and day, the stored balance of AD-5: an asset's value or
 * a liability's amount owed. Derived from `entries` and `holdings`, rewritten
 * by the ledger, read only through `balanceOn`.
 */
export const balances = sqliteTable(
	"balances",
	{
		accountId: text("account_id")
			.notNull()
			.references(() => accounts.id, { onDelete: "restrict" }),
		date: text("date").notNull(),
		balance: integer("balance").notNull(),
		/**
		 * The first term of `balance = cash + holdings value`, as Sure's
		 * `cash_balance` (AD-22): `balance` itself on an account that holds no
		 * security, every account but an investment one with trades.
		 */
		cash: integer("cash").$type<MinorUnits>().notNull(),
		currency: text("currency").notNull(),
	},
	(table) => [primaryKey({ columns: [table.accountId, table.date] })],
);
