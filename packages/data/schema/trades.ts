import type { Quantity, TradePrice } from "../decimals.ts";
import type { IncomeKind } from "../income-kinds.ts";
import type { MinorUnits } from "../money.ts";

import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { INCOME_KINDS } from "../income-kinds.ts";
import { inList } from "./check.ts";
import { entries } from "./entries.ts";
import { securities } from "./securities.ts";

/**
 * The trade-only columns of an entry whose `kind` is `trade`, as Sure's
 * `Trade` (AD-22). The date, the cash amount and the currency stay on
 * `entries`, where the balance computation reads every kind alike; the
 * amount is `-(quantity × price + fee)`, negative for a buy (AD-5), and an
 * income's is the cash it brought, above zero.
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
		// `null` for interest on the account's cash, which no security pays.
		securityId: text("security_id").references(() => securities.id, { onDelete: "restrict" }),
		/** `null` for a buy or a sale. */
		incomeKind: text("income_kind").$type<IncomeKind>(),
		/**
		 * Units as canonical decimal text, up to 18 decimals (`decimals.ts`):
		 * positive for a buy, negative for a sale, `0` for an income.
		 */
		quantity: text("quantity").$type<Quantity>().notNull(),
		/** The account currency's major unit per unit, canonical decimal text up to 10 decimals. */
		price: text("price").$type<TradePrice>().notNull(),
		/** Minor units of the account's currency. */
		fee: integer("fee").$type<MinorUnits>().notNull(),
	},
	(table) => [
		// The held securities and an income's `not_held` check read trades by security.
		index("trades_security").on(table.securityId),
		check(
			"trades_income_kind_check",
			sql`${table.incomeKind} is null or ${table.incomeKind} in ${inList(INCOME_KINDS)}`,
		),
		// Holdings drop a trade of quantity zero, as Sure's `PortfolioCache`: a
		// buy of nothing would vanish, and an income that moved a quantity
		// would change what the account holds.
		// The sign reads from the canonical text: zero is `'0'`, below zero
		// starts with `-`.
		check(
			"trades_quantity_check",
			sql`(${table.incomeKind} is null and ${table.quantity} <> '0') or (${table.incomeKind} is not null and ${table.quantity} = '0')`,
		),
		// Zero is a real price: a free share is still a buy.
		check("trades_price_check", sql`${table.price} not like '-%'`),
		check("trades_fee_check", sql`${table.fee} >= 0`),
		// An income is its amount alone.
		check(
			"trades_income_figures_check",
			sql`${table.incomeKind} is null or (${table.price} = '0' and ${table.fee} = 0)`,
		),
		// Sure's `Security.cash_for`: only interest is paid on cash. `is not
		// null` spelled out: a null comparison would let a buy through.
		check(
			"trades_security_check",
			sql`${table.securityId} is not null or (${table.incomeKind} is not null and ${table.incomeKind} = 'interest')`,
		),
	],
);
