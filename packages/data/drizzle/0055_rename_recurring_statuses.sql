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
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "recurring_transactions_key_check" CHECK(("__new_recurring_transactions"."merchant_id" is null) <> ("__new_recurring_transactions"."label_key" is null)),
	CONSTRAINT "recurring_transactions_status_check" CHECK("__new_recurring_transactions"."status" in ('suggested', 'active', 'inactive', 'ended')),
	CONSTRAINT "recurring_transactions_day_check" CHECK("__new_recurring_transactions"."expected_day_of_month" between 1 and 31)
);
--> statement-breakpoint
-- Edited by hand: drizzle-kit read the band and `dedup_scope` from the old table,
-- which has neither, and copied the old statuses the new check refuses. Each maps
-- to Sure's: a detected pattern awaits the owner, a confirmed one is followed, a
-- dismissed one is a tombstone. A series on an investment account becomes `ended`,
-- as Sure's #3565 migration does: its dividends and contributions are no bill.
INSERT INTO `__new_recurring_transactions`("id", "account_id", "merchant_id", "label_key", "label", "amount", "expected_amount_min", "expected_amount_max", "expected_amount_avg", "currency", "expected_day_of_month", "last_occurrence_date", "next_expected_date", "occurrence_count", "status", "manual", "dedup_scope", "created_at", "updated_at") SELECT "id", "account_id", "merchant_id", "label_key", "label", "amount", null, null, null, "currency", "expected_day_of_month", "last_occurrence_date", "next_expected_date", "occurrence_count", CASE WHEN "account_id" IN (SELECT "id" FROM `accounts` WHERE "type" = 'investment') THEN 'ended' WHEN "status" = 'detected' THEN 'suggested' WHEN "status" = 'confirmed' THEN 'active' WHEN "status" = 'dismissed' THEN 'ended' ELSE "status" END, "manual", '', "created_at", "updated_at" FROM `recurring_transactions`;--> statement-breakpoint
DROP TABLE `recurring_transactions`;--> statement-breakpoint
ALTER TABLE `__new_recurring_transactions` RENAME TO `recurring_transactions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_transactions_merchant_unique` ON `recurring_transactions` (`account_id`,`merchant_id`,`amount`,`currency`,`dedup_scope`) WHERE "recurring_transactions"."merchant_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_transactions_label_unique` ON `recurring_transactions` (`account_id`,`label_key`,`amount`,`currency`,`dedup_scope`) WHERE "recurring_transactions"."label_key" is not null;--> statement-breakpoint
CREATE INDEX `recurring_transactions_merchant` ON `recurring_transactions` (`merchant_id`);