import type {
	AllocationSource,
	AllocationState,
	ClosedSource,
	OccurrenceStatus,
} from "../recurring.ts";

import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import {
	ALLOCATION_SOURCES,
	ALLOCATION_STATES,
	CLOSED_SOURCES,
	OCCURRENCE_STATUSES,
} from "../recurring.ts";
import { inList } from "./check.ts";
import { entries } from "./entries.ts";
import { recurringTransactions } from "./recurring-transactions.ts";

/**
 * Sure's `RecurringOccurrence`: one due date of a series, the October rent.
 * Only `services/recurring/` writes it. Upcoming, due and overdue derive from
 * the dates, so they never go stale; the status stores only what closed it.
 */
export const recurringOccurrences = sqliteTable(
	"recurring_occurrences",
	{
		id: text("id").primaryKey(),
		recurringTransactionId: text("recurring_transaction_id")
			.notNull()
			.references(() => recurringTransactions.id, { onDelete: "cascade" }),
		// The schedule's date, the identity a regeneration upserts on.
		originalDueOn: text("original_due_on").notNull(),
		dueOn: text("due_on").notNull(),
		currency: text("currency").notNull(),
		// A positive magnitude in `currency`. Null reads the series' amount until
		// the first confirmed payment or a close freezes it, as Sure's.
		expectedAmount: integer("expected_amount"),
		status: text("status").$type<OccurrenceStatus>().notNull().default("scheduled"),
		snoozedUntil: text("snoozed_until"),
		closedAt: integer("closed_at"),
		closedSource: text("closed_source").$type<ClosedSource>(),
		notes: text("notes"),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		check(
			"recurring_occurrences_status_check",
			sql`${table.status} in ${inList(OCCURRENCE_STATUSES)}`,
		),
		check(
			"recurring_occurrences_closed_source_check",
			sql`${table.closedSource} is null or ${table.closedSource} in ${inList(CLOSED_SOURCES)}`,
		),
		check(
			"recurring_occurrences_closed_state_check",
			sql`(${table.status} = 'scheduled') = (${table.closedAt} is null)`,
		),
		check(
			"recurring_occurrences_expected_amount_check",
			sql`${table.expectedAmount} is null or ${table.expectedAmount} >= 0`,
		),
		uniqueIndex("recurring_occurrences_identity_unique").on(
			table.recurringTransactionId,
			table.originalDueOn,
		),
		index("recurring_occurrences_status_due").on(table.status, table.dueOn),
	],
);

/** Why the matcher scored a payment as it did, in ten-thousandths, as Sure's `match_signals`. */
export type MatchSignals = {
	merchant?: number | undefined;
	name?: number | undefined;
	amount?: number | undefined;
	date?: number | undefined;
	account?: number | undefined;
};

/**
 * Sure's `RecurringAllocation`: a payment, or part of one, toward one
 * occurrence. Several sum toward one occurrence and one transaction may pay
 * several, never beyond its own amount. `services/recurring/` writes it; the
 * ledger's `absorbEntry` only moves it onto the surviving entry (AD-17, AD-24). No currency of its own: an account
 * has one currency, so the occurrence's is the entry's (AD-6).
 */
export const recurringAllocations = sqliteTable(
	"recurring_allocations",
	{
		id: text("id").primaryKey(),
		recurringOccurrenceId: text("recurring_occurrence_id")
			.notNull()
			.references(() => recurringOccurrences.id, { onDelete: "cascade" }),
		// Set null, as Sure's `on_delete: :nullify`: a deleted transaction leaves
		// the payment and its amount standing, and the occurrence paid.
		entryId: text("entry_id").references(() => entries.id, { onDelete: "set null" }),
		// A positive magnitude in the occurrence's currency.
		allocatedAmount: integer("allocated_amount").notNull(),
		state: text("state").$type<AllocationState>().notNull(),
		source: text("source").$type<AllocationSource>().notNull(),
		// Ten-thousandths, 8500 being Sure's 0.85; null for a payment no matcher scored.
		matchConfidence: integer("match_confidence"),
		matchSignals: text("match_signals", { mode: "json" })
			.$type<MatchSignals>()
			.notNull()
			.default(sql`'{}'`),
		paidOn: text("paid_on"),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		check("recurring_allocations_amount_check", sql`${table.allocatedAmount} > 0`),
		check("recurring_allocations_state_check", sql`${table.state} in ${inList(ALLOCATION_STATES)}`),
		check(
			"recurring_allocations_source_check",
			sql`${table.source} in ${inList(ALLOCATION_SOURCES)}`,
		),
		uniqueIndex("recurring_allocations_entry_once")
			.on(table.recurringOccurrenceId, table.entryId)
			.where(sql`${table.entryId} is not null`),
		// Every entry delete sets its payments' entry null, and every capacity
		// check sums an entry's payments.
		index("recurring_allocations_entry").on(table.entryId),
	],
);

/**
 * Sure's `RecurringMatchRejection`: a transaction the owner refused for a
 * series, never suggested again. The ledger's `absorbEntry` moves it onto the
 * surviving entry (AD-17).
 */
export const recurringMatchRejections = sqliteTable(
	"recurring_match_rejections",
	{
		id: text("id").primaryKey(),
		recurringTransactionId: text("recurring_transaction_id")
			.notNull()
			.references(() => recurringTransactions.id, { onDelete: "cascade" }),
		entryId: text("entry_id")
			.notNull()
			.references(() => entries.id, { onDelete: "cascade" }),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		uniqueIndex("recurring_match_rejections_pair_unique").on(
			table.recurringTransactionId,
			table.entryId,
		),
		// The pair index serves a lookup by series; an entry delete needs its own.
		index("recurring_match_rejections_entry").on(table.entryId),
	],
);

/**
 * Sure's `RecurringPriceChange`: a series' charges settled on a new price.
 * Only detection writes one, so Sure's `source` has no column.
 */
export const recurringPriceChanges = sqliteTable(
	"recurring_price_changes",
	{
		id: text("id").primaryKey(),
		recurringTransactionId: text("recurring_transaction_id")
			.notNull()
			.references(() => recurringTransactions.id, { onDelete: "cascade" }),
		effectiveOn: text("effective_on").notNull(),
		// Positive magnitudes in `currency`.
		previousAmount: integer("previous_amount").notNull(),
		newAmount: integer("new_amount").notNull(),
		currency: text("currency").notNull(),
		// The payment that showed the new price; set null as Sure's.
		entryId: text("entry_id").references(() => entries.id, { onDelete: "set null" }),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		check(
			"recurring_price_changes_amounts_check",
			sql`${table.previousAmount} >= 0 and ${table.newAmount} > 0`,
		),
		uniqueIndex("recurring_price_changes_identity_unique").on(
			table.recurringTransactionId,
			table.effectiveOn,
		),
		index("recurring_price_changes_entry").on(table.entryId),
	],
);
