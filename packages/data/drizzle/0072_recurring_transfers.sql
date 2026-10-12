PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_recurring_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text,
	`destination_account_id` text,
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
	`name_aliases` text DEFAULT '[]' NOT NULL,
	`learned_tolerance` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`destination_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "recurring_transactions_key_check" CHECK(case when "__new_recurring_transactions"."destination_account_id" is null then ("__new_recurring_transactions"."merchant_id" is null) <> ("__new_recurring_transactions"."label_key" is null) else "__new_recurring_transactions"."merchant_id" is null and "__new_recurring_transactions"."label_key" is null end),
	CONSTRAINT "recurring_transactions_transfer_requires_source" CHECK("__new_recurring_transactions"."destination_account_id" is null or "__new_recurring_transactions"."account_id" is not null),
	CONSTRAINT "recurring_transactions_transfer_distinct_accounts" CHECK("__new_recurring_transactions"."destination_account_id" is null or "__new_recurring_transactions"."destination_account_id" <> "__new_recurring_transactions"."account_id"),
	CONSTRAINT "recurring_transactions_status_check" CHECK("__new_recurring_transactions"."status" in ('suggested', 'active', 'inactive', 'ended')),
	CONSTRAINT "recurring_transactions_day_check" CHECK("__new_recurring_transactions"."expected_day_of_month" between 1 and 31),
	CONSTRAINT "recurring_transactions_bill_type_check" CHECK("__new_recurring_transactions"."bill_type" in ('bill', 'subscription', 'installment', 'income', 'transfer', 'other')),
	CONSTRAINT "recurring_transactions_transfer_type_check" CHECK(("__new_recurring_transactions"."bill_type" = 'transfer') = ("__new_recurring_transactions"."destination_account_id" is not null)),
	CONSTRAINT "recurring_transactions_end_after_count_check" CHECK("__new_recurring_transactions"."end_after_count" is null or "__new_recurring_transactions"."end_after_count" between 1 and 600)
);
--> statement-breakpoint
-- Edited by hand: drizzle-kit read `destination_account_id` from the old table,
-- which has none. An active or inactive series whose every payment is the
-- outflow of a loan payment or an investment contribution, all from one account
-- (its own, when it has one) into one other, is a transfer no bill may take any
-- more: it becomes a recurring transfer into that account, as Sure's, its name,
-- rules, occurrences and payments kept, its merchant and label key cleared, and
-- manual, as every one of Sure's is. Of several that would
-- share a pair, amount, currency and dedup scope, the oldest converts and the
-- others stay as they are.
INSERT INTO `__new_recurring_transactions`("id", "account_id", "destination_account_id", "merchant_id", "label_key", "label", "amount", "expected_amount_min", "expected_amount_max", "expected_amount_avg", "currency", "expected_day_of_month", "last_occurrence_date", "next_expected_date", "occurrence_count", "status", "manual", "dedup_scope", "name", "anchor_date", "end_after_count", "bill_type", "category_id", "autopay", "notes", "payment_url", "schedule_pinned_at", "name_aliases", "learned_tolerance", "created_at", "updated_at") WITH `paid_by_transfer` AS (SELECT `o`.`recurring_transaction_id` AS `series_id`, min(`oe`.`account_id`) AS `source_id`, min(`ie`.`account_id`) AS `destination_id` FROM `recurring_allocations` `a` JOIN `recurring_occurrences` `o` ON `o`.`id` = `a`.`recurring_occurrence_id` LEFT JOIN `transfers` `t` ON `t`.`outflow_transaction_id` = `a`.`entry_id` AND `t`.`kind` IN ('loan_payment', 'investment_contribution') LEFT JOIN `entries` `oe` ON `oe`.`id` = `t`.`outflow_transaction_id` LEFT JOIN `entries` `ie` ON `ie`.`id` = `t`.`inflow_transaction_id` WHERE `a`.`entry_id` IS NOT NULL GROUP BY `o`.`recurring_transaction_id` HAVING count(*) = count(`ie`.`id`) AND count(DISTINCT `oe`.`account_id`) = 1 AND count(DISTINCT `ie`.`account_id`) = 1), `converted` AS (SELECT `r`.`id`, `p`.`source_id`, `p`.`destination_id`, row_number() OVER (PARTITION BY `p`.`source_id`, `p`.`destination_id`, `r`.`amount`, `r`.`currency`, `r`.`dedup_scope` ORDER BY `r`.`created_at`, `r`.`id`) AS `rank` FROM `recurring_transactions` `r` JOIN `paid_by_transfer` `p` ON `p`.`series_id` = `r`.`id` WHERE `r`.`status` IN ('active', 'inactive') AND (`r`.`account_id` IS NULL OR `r`.`account_id` = `p`.`source_id`) AND `p`.`source_id` <> `p`.`destination_id`) SELECT `r`."id", CASE WHEN `c`.`id` IS NULL THEN `r`."account_id" ELSE `c`.`source_id` END, `c`.`destination_id`, CASE WHEN `c`.`id` IS NULL THEN `r`."merchant_id" END, CASE WHEN `c`.`id` IS NULL THEN `r`."label_key" END, `r`."label", `r`."amount", `r`."expected_amount_min", `r`."expected_amount_max", `r`."expected_amount_avg", `r`."currency", `r`."expected_day_of_month", `r`."last_occurrence_date", `r`."next_expected_date", `r`."occurrence_count", `r`."status", CASE WHEN `c`.`id` IS NULL THEN `r`."manual" ELSE 1 END, `r`."dedup_scope", `r`."name", `r`."anchor_date", `r`."end_after_count", CASE WHEN `c`.`id` IS NULL THEN `r`."bill_type" ELSE 'transfer' END, `r`."category_id", `r`."autopay", `r`."notes", `r`."payment_url", `r`."schedule_pinned_at", `r`."name_aliases", `r`."learned_tolerance", `r`."created_at", `r`."updated_at" FROM `recurring_transactions` `r` LEFT JOIN `converted` `c` ON `c`.`id` = `r`.`id` AND `c`.`rank` = 1;--> statement-breakpoint
DROP TABLE `recurring_transactions`;--> statement-breakpoint
ALTER TABLE `__new_recurring_transactions` RENAME TO `recurring_transactions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_transactions_merchant_unique` ON `recurring_transactions` (`account_id`,`merchant_id`,`amount`,`currency`,`dedup_scope`) WHERE "recurring_transactions"."merchant_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_transactions_label_unique` ON `recurring_transactions` (`account_id`,`label_key`,`amount`,`currency`,`dedup_scope`) WHERE "recurring_transactions"."label_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_transactions_transfer_unique` ON `recurring_transactions` (`account_id`,`destination_account_id`,`amount`,`currency`,`dedup_scope`) WHERE "recurring_transactions"."destination_account_id" is not null;--> statement-breakpoint
CREATE INDEX `recurring_transactions_merchant` ON `recurring_transactions` (`merchant_id`);--> statement-breakpoint
CREATE INDEX `recurring_transactions_destination` ON `recurring_transactions` (`destination_account_id`);