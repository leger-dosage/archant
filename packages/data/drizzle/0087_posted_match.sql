-- drizzle-kit copies the new columns from the old table, which has none;
-- written by hand so existing pending entries start with no suggestion.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_transactions` (
	`entry_id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`notes` text,
	`reference` text,
	`excluded` integer DEFAULT false NOT NULL,
	`one_time` integer DEFAULT false NOT NULL,
	`possible_duplicate` integer DEFAULT false NOT NULL,
	`pending` integer DEFAULT false NOT NULL,
	`posted_match_id` text,
	`posted_match_confidence` text,
	`posted_match_dismissed` integer DEFAULT false NOT NULL,
	`locked_fields` text DEFAULT '{}' NOT NULL,
	`category_id` text,
	`category_origin` text,
	`merchant_id` text,
	`expected_transfer_account_id` text,
	`investment_activity_label` text,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`posted_match_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`expected_transfer_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "transactions_category_origin_check" CHECK("__new_transactions"."category_origin" in ('user', 'rule', 'provider')),
	CONSTRAINT "transactions_category_origin_set_check" CHECK(("__new_transactions"."category_id" is null) = ("__new_transactions"."category_origin" is null)),
	CONSTRAINT "transactions_posted_match_confidence_check" CHECK("__new_transactions"."posted_match_confidence" in ('medium', 'low')),
	CONSTRAINT "transactions_investment_activity_label_check" CHECK("__new_transactions"."investment_activity_label" in ('Buy', 'Sell', 'Sweep In', 'Sweep Out', 'Dividend', 'Reinvestment', 'Interest', 'Fee', 'Transfer', 'Contribution', 'Withdrawal', 'Exchange', 'Other'))
);
--> statement-breakpoint
INSERT INTO `__new_transactions`("entry_id", "label", "notes", "reference", "excluded", "one_time", "possible_duplicate", "pending", "locked_fields", "category_id", "category_origin", "merchant_id", "expected_transfer_account_id", "investment_activity_label") SELECT "entry_id", "label", "notes", "reference", "excluded", "one_time", "possible_duplicate", "pending", "locked_fields", "category_id", "category_origin", "merchant_id", "expected_transfer_account_id", "investment_activity_label" FROM `transactions`;--> statement-breakpoint
DROP TABLE `transactions`;--> statement-breakpoint
ALTER TABLE `__new_transactions` RENAME TO `transactions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `transactions_category` ON `transactions` (`category_id`);--> statement-breakpoint
CREATE INDEX `transactions_merchant` ON `transactions` (`merchant_id`);--> statement-breakpoint
CREATE INDEX `transactions_posted_match` ON `transactions` (`posted_match_id`);