import type { Micros } from "../micros.ts";
import type { MinorUnits } from "../money.ts";

import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
		 * The weighted average price of the buys, each buy's fee in its cost, a
		 * sale's fee out, in millionths per unit, as Sure's `CostBasisTracker`;
		 * `null` while nothing is held.
		 */
		costBasis: integer("cost_basis").$type<Micros>(),
	},
	(table) => [
		// By account then day: the balance recompute reads and rewrites an
		// account's days from a date on, the export pages along it.
		primaryKey({ columns: [table.accountId, table.date, table.securityId] }),
		// A position's last day at zero, which ends a cost basis lock: the
		// days at zero are few, so the lock read never walks every holding.
		index("holdings_zero_quantity")
			.on(table.accountId, table.securityId, table.date)
			.where(sql`quantity = 0`),
		check("holdings_quantity_check", sql`${table.quantity} >= 0`),
		check("holdings_price_check", sql`${table.price} >= 0`),
		check("holdings_amount_check", sql`${table.amount} >= 0`),
	],
);

/**
 * A cost basis the owner set by hand, as Sure's `set_manual_cost_basis!`:
 * it locks the average cost of the position held on `lockedOn`, which every
 * reader takes instead of the calculated one on that position's days, as
 * Sure's `cost_basis_source` ranks manual above calculated. A full sale on
 * or after `lockedOn` ends that position, and the lock with it: a rebuy is
 * priced from its own buys. Holdings keep the calculated one, so unlocking
 * deletes the row and it is back, with no recompute: a cost basis moves no
 * balance (AD-22).
 */
export const costBasisLocks = sqliteTable(
	"cost_basis_locks",
	{
		// Cascade: a lock means nothing once its account is gone.
		accountId: text("account_id")
			.notNull()
			.references(() => accounts.id, { onDelete: "cascade" }),
		// Restrict: a security someone held is history, never deleted under it.
		securityId: text("security_id")
			.notNull()
			.references(() => securities.id, { onDelete: "restrict" }),
		/** Millionths of the account currency's major unit, per unit. */
		costBasis: integer("cost_basis").$type<Micros>().notNull(),
		/** `YYYY-MM-DD` in `APP_TIMEZONE`: the day the owner locked it. */
		lockedOn: text("locked_on").notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.accountId, table.securityId] }),
		check("cost_basis_locks_cost_basis_check", sql`${table.costBasis} >= 0`),
	],
);
