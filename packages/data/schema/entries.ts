import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { accounts } from "./accounts.ts";
import { inList } from "./check.ts";

export const ENTRY_KINDS = ["transaction", "valuation"] as const;

export type EntryKind = (typeof ENTRY_KINDS)[number];

/**
 * A valuation's amount is a stored balance (AD-5, AD-8), never a delta.
 * `opening_anchor` is created with the account and is the start of its forward
 * computation; the two others arrive with snapshots and bank sync.
 */
export const VALUATION_KINDS = ["opening_anchor", "reconciliation", "current_anchor"] as const;

export type ValuationKind = (typeof VALUATION_KINDS)[number];

export const entries = sqliteTable(
	"entries",
	{
		id: text("id").primaryKey(),
		// Restrict, not cascade: deleting an account goes through the ledger, which
		// removes its entries first. A bypass fails instead of erasing history.
		accountId: text("account_id")
			.notNull()
			.references(() => accounts.id, { onDelete: "restrict" }),
		kind: text("kind").$type<EntryKind>().notNull(),
		valuationKind: text("valuation_kind").$type<ValuationKind>(),
		date: text("date").notNull(),
		amount: integer("amount").notNull(),
		currency: text("currency").notNull(),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		check("entries_kind_check", sql`${table.kind} in ${inList(ENTRY_KINDS)}`),
		// `is not null` spelled out: `null in (...)` is null, which a check lets through.
		check(
			"entries_valuation_kind_check",
			sql`(${table.kind} = 'valuation' and ${table.valuationKind} is not null and ${table.valuationKind} in ${inList(VALUATION_KINDS)}) or (${table.kind} = 'transaction' and ${table.valuationKind} is null)`,
		),
		// Exactly one starting point per account: two opening anchors would make
		// the forward computation depend on which one a query happens to return.
		uniqueIndex("entries_one_opening_anchor")
			.on(table.accountId)
			.where(sql`${table.valuationKind} = 'opening_anchor'`),
		// One snapshot per account and day: a second one on the same date replaces
		// the first in the ledger, and two would leave the day's balance to
		// whichever row the recompute happened to read last.
		uniqueIndex("entries_one_reconciliation_per_day")
			.on(table.accountId, table.date)
			.where(sql`${table.valuationKind} = 'reconciliation'`),
		index("entries_account_date").on(table.accountId, table.date),
	],
);
