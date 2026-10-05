import type { RecurrenceFrequency } from "../recurring.ts";

import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { LAST_DAY_OF_MONTH, RECURRENCE_FREQUENCIES } from "../recurring.ts";
import { inList } from "./check.ts";
import { recurringTransactions } from "./recurring-transactions.ts";

/**
 * Sure's `RecurrenceRule`: one repetition of a series, « monthly on the 15th ».
 * Twice a month is two rows. Every series has at least one: detection and
 * « Ajouter aux récurrences » write a monthly one on the series' day, where
 * Sure builds the same rule implicitly. A weekly rule falls on a weekday, a
 * monthly one on a day of the month, the last being −1, a yearly one on a
 * day of a month, as Sure's `day_spec_coherent` without the nth weekday.
 */
export const recurrenceRules = sqliteTable(
	"recurrence_rules",
	{
		id: text("id").primaryKey(),
		recurringTransactionId: text("recurring_transaction_id")
			.notNull()
			.references(() => recurringTransactions.id, { onDelete: "cascade" }),
		frequency: text("frequency").$type<RecurrenceFrequency>().notNull(),
		interval: integer("interval").notNull().default(1),
		dayOfMonth: integer("day_of_month"),
		// 0 is Sunday, as Ruby's `Date#wday`.
		weekday: integer("weekday"),
		monthOfYear: integer("month_of_year"),
		position: integer("position").notNull().default(0),
	},
	(table) => [
		check(
			"recurrence_rules_frequency_check",
			sql`${table.frequency} in ${inList(RECURRENCE_FREQUENCIES)}`,
		),
		check("recurrence_rules_interval_check", sql`${table.interval} > 0`),
		check(
			"recurrence_rules_day_check",
			sql`${table.dayOfMonth} is null or (${table.dayOfMonth} between ${sql.raw(String(LAST_DAY_OF_MONTH))} and 31 and ${table.dayOfMonth} <> 0)`,
		),
		check(
			"recurrence_rules_weekday_check",
			sql`${table.weekday} is null or ${table.weekday} between 0 and 6`,
		),
		check(
			"recurrence_rules_month_check",
			sql`${table.monthOfYear} is null or ${table.monthOfYear} between 1 and 12`,
		),
		check("recurrence_rules_position_check", sql`${table.position} >= 0`),
		check(
			"recurrence_rules_single_day_check",
			sql`not (${table.dayOfMonth} is not null and ${table.weekday} is not null)`,
		),
		check(
			"recurrence_rules_shape_check",
			sql`(${table.frequency} = 'weekly' and ${table.weekday} is not null and ${table.dayOfMonth} is null and ${table.monthOfYear} is null) or (${table.frequency} = 'monthly' and ${table.dayOfMonth} is not null and ${table.weekday} is null and ${table.monthOfYear} is null) or (${table.frequency} = 'yearly' and ${table.dayOfMonth} is not null and ${table.weekday} is null and ${table.monthOfYear} is not null)`,
		),
		uniqueIndex("recurrence_rules_position_unique").on(
			table.recurringTransactionId,
			table.position,
		),
	],
);
