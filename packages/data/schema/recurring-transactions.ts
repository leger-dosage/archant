import type { BillType } from "../recurring.ts";

import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { BILL_TYPES, MAX_END_AFTER_COUNT } from "../recurring.ts";
import { accounts } from "./accounts.ts";
import { categories } from "./categories.ts";
import { inList } from "./check.ts";
import { merchants } from "./merchants.ts";

/**
 * Sure's statuses at `14638a701`, without `paused`: `suggested` is found by
 * detection and awaits the owner, `active` is a payment the owner follows,
 * `inactive` is paused by hand or retired by the cleaner, and `ended` is a
 * tombstone that detection claims and never recreates.
 */
export const RECURRING_STATUSES = ["suggested", "active", "inactive", "ended"] as const;

export type RecurringStatus = (typeof RECURRING_STATUSES)[number];

/**
 * Sure's `RecurringTransaction`: a payment that recurs on its schedule, the
 * `recurrence_rules` that point at it, for amounts within 7.5 % of each other.
 * Grouped by merchant when the rows have one, else by their normalised label,
 * never both. Detection or the owner writes it; no entry points at it and it
 * points at no entry.
 */
export const recurringTransactions = sqliteTable(
	"recurring_transactions",
	{
		id: text("id").primaryKey(),
		accountId: text("account_id")
			.notNull()
			.references(() => accounts.id, { onDelete: "cascade" }),
		// Cascade: a merged merchant's patterns come back under the target at the
		// next detection, since its rows now carry the target's id.
		merchantId: text("merchant_id").references(() => merchants.id, { onDelete: "cascade" }),
		labelKey: text("label_key"),
		// The latest row's raw label, for display.
		label: text("label").notNull(),
		// The latest row's amount, signed as its transactions (AD-5).
		amount: integer("amount").notNull(),
		// Sure's variance band, signed like `amount`: for an expense the minimum
		// is the largest magnitude.
		expectedAmountMin: integer("expected_amount_min"),
		expectedAmountMax: integer("expected_amount_max"),
		expectedAmountAvg: integer("expected_amount_avg"),
		currency: text("currency").notNull(),
		expectedDayOfMonth: integer("expected_day_of_month").notNull(),
		lastOccurrenceDate: text("last_occurrence_date").notNull(),
		nextExpectedDate: text("next_expected_date").notNull(),
		occurrenceCount: integer("occurrence_count").notNull(),
		status: text("status").$type<RecurringStatus>().notNull().default("suggested"),
		// Added by hand from a transaction, as Sure's `manual`.
		manual: integer("manual", { mode: "boolean" }).notNull().default(false),
		// Sure's `dedup_scope`: empty for the first series of a key, the cluster's
		// mean for a second tier of the same key, so tiers never collide.
		dedupScope: text("dedup_scope").notNull().default(""),
		// What the owner calls it; the interface shows it before the merchant or
		// the label, while matching keeps reading the key, as Sure's `display_name`.
		name: text("name"),
		// Which week, month or year an every-N rule falls in; `null` reads the
		// last occurrence date, as Sure's `Schedule.for`.
		anchorDate: text("anchor_date"),
		// An installment ends after this many payments from the anchor, as
		// Sure's `end_mode` `after_count`; `null` never ends.
		endAfterCount: integer("end_after_count"),
		billType: text("bill_type").$type<BillType>().notNull().default("bill"),
		// Set null, as Sure's `replace_and_destroy!`: a merged or deleted
		// category leaves the series uncategorised.
		categoryId: text("category_id").references(() => categories.id, { onDelete: "set null" }),
		autopay: integer("autopay", { mode: "boolean" }).notNull().default(false),
		notes: text("notes"),
		paymentUrl: text("payment_url"),
		// Sure's `schedule_pinned_at` hint: the owner set the cadence, so
		// detection moves the dates but never the day or the rules.
		schedulePinnedAt: integer("schedule_pinned_at"),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		check(
			"recurring_transactions_key_check",
			sql`(${table.merchantId} is null) <> (${table.labelKey} is null)`,
		),
		check(
			"recurring_transactions_status_check",
			sql`${table.status} in ${inList(RECURRING_STATUSES)}`,
		),
		check("recurring_transactions_day_check", sql`${table.expectedDayOfMonth} between 1 and 31`),
		check(
			"recurring_transactions_bill_type_check",
			sql`${table.billType} in ${inList(BILL_TYPES)}`,
		),
		check(
			"recurring_transactions_end_after_count_check",
			sql`${table.endAfterCount} is null or ${table.endAfterCount} between 1 and ${sql.raw(String(MAX_END_AFTER_COUNT))}`,
		),
		uniqueIndex("recurring_transactions_merchant_unique")
			.on(table.accountId, table.merchantId, table.amount, table.currency, table.dedupScope)
			.where(sql`${table.merchantId} is not null`),
		uniqueIndex("recurring_transactions_label_unique")
			.on(table.accountId, table.labelKey, table.amount, table.currency, table.dedupScope)
			.where(sql`${table.labelKey} is not null`),
		index("recurring_transactions_merchant").on(table.merchantId),
	],
);
