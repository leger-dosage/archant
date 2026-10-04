import type { Micros } from "../micros.ts";
import type { MinorUnits } from "../money.ts";

import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { entries } from "./entries.ts";
import { securities } from "./securities.ts";

/**
 * The trade-only columns of an entry whose `kind` is `trade`, as Sure's
 * `Trade` (AD-22). The date, the cash amount and the currency stay on
 * `entries`, where the balance computation reads every kind alike; the
 * amount is `-(quantity × price + fee)`, negative for a buy (AD-5).
 */
export const trades = sqliteTable(
	"trades",
	{
		// Restrict, not cascade: only the ledger deletes an entry, and it removes
		// this row first. A bypass fails instead of leaving the entry half gone.
		entryId: text("entry_id")
			.primaryKey()
			.references(() => entries.id, { onDelete: "restrict" }),
		// Restrict: a security someone traded is history, never deleted under it.
		securityId: text("security_id")
			.notNull()
			.references(() => securities.id, { onDelete: "restrict" }),
		/** Millionths of a unit, signed: positive for a buy, negative for a sale. */
		quantity: integer("quantity").$type<Micros>().notNull(),
		/** Millionths of the account currency's major unit, per unit. */
		price: integer("price").$type<Micros>().notNull(),
		/** Minor units of the account's currency. */
		fee: integer("fee").$type<MinorUnits>().notNull(),
	},
	(table) => [
		// The held securities and the quantity check read trades by security.
		index("trades_security").on(table.securityId),
		check("trades_quantity_check", sql`${table.quantity} <> 0`),
		// Zero is a real price: a free share is still a buy.
		check("trades_price_check", sql`${table.price} >= 0`),
		check("trades_fee_check", sql`${table.fee} >= 0`),
	],
);
