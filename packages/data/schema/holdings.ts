import type { Micros } from "../micros.ts";
import type { MinorUnits } from "../money.ts";

import { sql } from "drizzle-orm";
import { check, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { accounts } from "./accounts.ts";
import { securities } from "./securities.ts";

/**
 * Sure's `Holding`: what an investment account holds of one security at the
 * end of one day, from its first trade in it to the account's last balance
 * day, every day after a full sale included at quantity zero. Derived from
 * `trades` and `security_prices` by the ledger's balance recompute, as Sure's
 * `Holding::ForwardCalculator`; the ledger deletes them with their account
 * and writes them nowhere else (AD-2, AD-22).
 */
export const holdings = sqliteTable(
	"holdings",
	{
		// Restrict: only the ledger deletes an account, and it removes these first.
		accountId: text("account_id")
			.notNull()
			.references(() => accounts.id, { onDelete: "restrict" }),
		// Restrict: a security someone held is history, never deleted under it.
		securityId: text("security_id")
			.notNull()
			.references(() => securities.id, { onDelete: "restrict" }),
		/** `YYYY-MM-DD`. */
		date: text("date").notNull(),
		/** Millionths of a unit held at the end of the day. */
		quantity: integer("quantity").$type<Micros>().notNull(),
		/** Millionths of the account currency's major unit, per unit: the day's price. */
		price: integer("price").$type<Micros>().notNull(),
		/** `quantity × price`, in minor units of the account's currency. */
		amount: integer("amount").$type<MinorUnits>().notNull(),
		/**
		 * The weighted average price of the buys, fees out, in millionths per
		 * unit, as Sure's `CostBasisTracker`; `null` while nothing is held.
		 */
		costBasis: integer("cost_basis").$type<Micros>(),
	},
	(table) => [
		// By account then day: the balance recompute reads and rewrites an
		// account's days from a date on, the export pages along it.
		primaryKey({ columns: [table.accountId, table.date, table.securityId] }),
		check("holdings_quantity_check", sql`${table.quantity} >= 0`),
		check("holdings_price_check", sql`${table.price} >= 0`),
		check("holdings_amount_check", sql`${table.amount} >= 0`),
	],
);
