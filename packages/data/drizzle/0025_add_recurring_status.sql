PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_recurring_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`merchant_id` text,
	`label_key` text,
	`label` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`expected_day_of_month` integer NOT NULL,
	`last_occurrence_date` text NOT NULL,
	`next_expected_date` text NOT NULL,
	`occurrence_count` integer NOT NULL,
	`status` text DEFAULT 'detected' NOT NULL,
	`manual` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "recurring_transactions_key_check" CHECK(("__new_recurring_transactions"."merchant_id" is null) <> ("__new_recurring_transactions"."label_key" is null)),
	CONSTRAINT "recurring_transactions_status_check" CHECK("__new_recurring_transactions"."status" in ('detected', 'confirmed', 'inactive', 'dismissed')),
	CONSTRAINT "recurring_transactions_day_check" CHECK("__new_recurring_transactions"."expected_day_of_month" between 1 and 31)
);
--> statement-breakpoint
-- Edited by hand: drizzle-kit read `status` and `manual` from the old table, which
-- has neither. Every stored row came from detection, so it is `detected`, not manual.
INSERT INTO `__new_recurring_transactions`("id", "account_id", "merchant_id", "label_key", "label", "amount", "currency", "expected_day_of_month", "last_occurrence_date", "next_expected_date", "occurrence_count", "status", "manual", "created_at", "updated_at") SELECT "id", "account_id", "merchant_id", "label_key", "label", "amount", "currency", "expected_day_of_month", "last_occurrence_date", "next_expected_date", "occurrence_count", 'detected', false, "created_at", "updated_at" FROM `recurring_transactions`;--> statement-breakpoint
DROP TABLE `recurring_transactions`;--> statement-breakpoint
ALTER TABLE `__new_recurring_transactions` RENAME TO `recurring_transactions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_transactions_merchant_unique` ON `recurring_transactions` (`account_id`,`merchant_id`,`amount`) WHERE "recurring_transactions"."merchant_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_transactions_label_unique` ON `recurring_transactions` (`account_id`,`label_key`,`amount`) WHERE "recurring_transactions"."label_key" is not null;--> statement-breakpoint
CREATE INDEX `recurring_transactions_merchant` ON `recurring_transactions` (`merchant_id`);