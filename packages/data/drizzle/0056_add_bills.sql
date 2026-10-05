CREATE TABLE `recurrence_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`recurring_transaction_id` text NOT NULL,
	`frequency` text NOT NULL,
	`interval` integer DEFAULT 1 NOT NULL,
	`day_of_month` integer,
	`weekday` integer,
	`month_of_year` integer,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`recurring_transaction_id`) REFERENCES `recurring_transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "recurrence_rules_frequency_check" CHECK("recurrence_rules"."frequency" in ('weekly', 'monthly', 'yearly')),
	CONSTRAINT "recurrence_rules_interval_check" CHECK("recurrence_rules"."interval" > 0),
	CONSTRAINT "recurrence_rules_day_check" CHECK("recurrence_rules"."day_of_month" is null or ("recurrence_rules"."day_of_month" between -1 and 31 and "recurrence_rules"."day_of_month" <> 0)),
	CONSTRAINT "recurrence_rules_weekday_check" CHECK("recurrence_rules"."weekday" is null or "recurrence_rules"."weekday" between 0 and 6),
	CONSTRAINT "recurrence_rules_month_check" CHECK("recurrence_rules"."month_of_year" is null or "recurrence_rules"."month_of_year" between 1 and 12),
	CONSTRAINT "recurrence_rules_position_check" CHECK("recurrence_rules"."position" >= 0),
	CONSTRAINT "recurrence_rules_single_day_check" CHECK(not ("recurrence_rules"."day_of_month" is not null and "recurrence_rules"."weekday" is not null)),
	CONSTRAINT "recurrence_rules_shape_check" CHECK(("recurrence_rules"."frequency" = 'weekly' and "recurrence_rules"."weekday" is not null and "recurrence_rules"."day_of_month" is null and "recurrence_rules"."month_of_year" is null) or ("recurrence_rules"."frequency" = 'monthly' and "recurrence_rules"."day_of_month" is not null and "recurrence_rules"."weekday" is null and "recurrence_rules"."month_of_year" is null) or ("recurrence_rules"."frequency" = 'yearly' and "recurrence_rules"."day_of_month" is not null and "recurrence_rules"."weekday" is null and "recurrence_rules"."month_of_year" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recurrence_rules_position_unique` ON `recurrence_rules` (`recurring_transaction_id`,`position`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_recurring_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`merchant_id` text,
	`label_key` text,
	`label` text NOT NULL,
	`amount` integer NOT NULL,
	`expected_amount_min` integer,
	`expected_amount_max` integer,
	`expected_amount_avg` integer,
	`currency` text NOT NULL,
	`expected_day_of_month` integer NOT NULL,
	`last_occurrence_date` text NOT NULL,
	`next_expected_date` text NOT NULL,
	`occurrence_count` integer NOT NULL,
	`status` text DEFAULT 'suggested' NOT NULL,
	`manual` integer DEFAULT false NOT NULL,
	`dedup_scope` text DEFAULT '' NOT NULL,
	`name` text,
	`anchor_date` text,
	`end_after_count` integer,
	`bill_type` text DEFAULT 'bill' NOT NULL,
	`category_id` text,
	`autopay` integer DEFAULT false NOT NULL,
	`notes` text,
	`payment_url` text,
	`schedule_pinned_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "recurring_transactions_key_check" CHECK(("__new_recurring_transactions"."merchant_id" is null) <> ("__new_recurring_transactions"."label_key" is null)),
	CONSTRAINT "recurring_transactions_status_check" CHECK("__new_recurring_transactions"."status" in ('suggested', 'active', 'inactive', 'ended')),
	CONSTRAINT "recurring_transactions_day_check" CHECK("__new_recurring_transactions"."expected_day_of_month" between 1 and 31),
	CONSTRAINT "recurring_transactions_bill_type_check" CHECK("__new_recurring_transactions"."bill_type" in ('bill', 'subscription', 'installment', 'income', 'other')),
	CONSTRAINT "recurring_transactions_end_after_count_check" CHECK("__new_recurring_transactions"."end_after_count" is null or "__new_recurring_transactions"."end_after_count" between 1 and 600)
);
--> statement-breakpoint
-- Edited by hand: drizzle-kit copied the bill columns from the old table, which
-- has none. As Sure's `create_bills_subsystem`, every series is anchored on its
-- last occurrence, and is an income when money comes in, else a bill (AD-5:
-- Archant's inflows are positive where Sure's are negative).
INSERT INTO `__new_recurring_transactions`("id", "account_id", "merchant_id", "label_key", "label", "amount", "expected_amount_min", "expected_amount_max", "expected_amount_avg", "currency", "expected_day_of_month", "last_occurrence_date", "next_expected_date", "occurrence_count", "status", "manual", "dedup_scope", "name", "anchor_date", "end_after_count", "bill_type", "category_id", "autopay", "notes", "payment_url", "schedule_pinned_at", "created_at", "updated_at") SELECT "id", "account_id", "merchant_id", "label_key", "label", "amount", "expected_amount_min", "expected_amount_max", "expected_amount_avg", "currency", "expected_day_of_month", "last_occurrence_date", "next_expected_date", "occurrence_count", "status", "manual", "dedup_scope", null, "last_occurrence_date", null, CASE WHEN "amount" > 0 THEN 'income' ELSE 'bill' END, null, false, null, null, null, "created_at", "updated_at" FROM `recurring_transactions`;--> statement-breakpoint
DROP TABLE `recurring_transactions`;--> statement-breakpoint
ALTER TABLE `__new_recurring_transactions` RENAME TO `recurring_transactions`;--> statement-breakpoint
-- Edited by hand: every series was monthly on its expected day, and now says so
-- in one rule, as Sure's `create_bills_subsystem`. SQLite has no UUID function,
-- so the id is a version 4 UUID built from random bytes.
INSERT INTO `recurrence_rules`("id", "recurring_transaction_id", "frequency", "interval", "day_of_month", "weekday", "month_of_year", "position") SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + abs(random()) % 4, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))), "id", 'monthly', 1, "expected_day_of_month", null, null, 0 FROM `recurring_transactions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_transactions_merchant_unique` ON `recurring_transactions` (`account_id`,`merchant_id`,`amount`,`currency`,`dedup_scope`) WHERE "recurring_transactions"."merchant_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_transactions_label_unique` ON `recurring_transactions` (`account_id`,`label_key`,`amount`,`currency`,`dedup_scope`) WHERE "recurring_transactions"."label_key" is not null;--> statement-breakpoint
CREATE INDEX `recurring_transactions_merchant` ON `recurring_transactions` (`merchant_id`);