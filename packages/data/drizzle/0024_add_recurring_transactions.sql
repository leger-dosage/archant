CREATE TABLE `recurring_transactions` (
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
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "recurring_transactions_key_check" CHECK(("recurring_transactions"."merchant_id" is null) <> ("recurring_transactions"."label_key" is null)),
	CONSTRAINT "recurring_transactions_day_check" CHECK("recurring_transactions"."expected_day_of_month" between 1 and 31)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_transactions_merchant_unique` ON `recurring_transactions` (`account_id`,`merchant_id`,`amount`) WHERE "recurring_transactions"."merchant_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_transactions_label_unique` ON `recurring_transactions` (`account_id`,`label_key`,`amount`) WHERE "recurring_transactions"."label_key" is not null;--> statement-breakpoint
CREATE INDEX `recurring_transactions_merchant` ON `recurring_transactions` (`merchant_id`);