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
	`pending_missed_syncs` integer DEFAULT 0 NOT NULL,
	`pending_missed_on` text,
	`locked_fields` text DEFAULT '{}' NOT NULL,
	`category_id` text,
	`category_origin` text,
	`merchant_id` text,
	`expected_transfer_account_id` text,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`expected_transfer_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "transactions_category_origin_check" CHECK("__new_transactions"."category_origin" in ('user', 'rule', 'provider')),
	CONSTRAINT "transactions_category_origin_set_check" CHECK(("__new_transactions"."category_id" is null) = ("__new_transactions"."category_origin" is null))
);
--> statement-breakpoint
INSERT INTO `__new_transactions`("entry_id", "label", "notes", "reference", "excluded", "one_time", "possible_duplicate", "pending", "pending_missed_syncs", "pending_missed_on", "locked_fields", "category_id", "category_origin", "merchant_id", "expected_transfer_account_id") SELECT "entry_id", "label", "notes", "reference", "excluded", "one_time", "possible_duplicate", "pending", "pending_missed_syncs", "pending_missed_on", "locked_fields", "category_id", "category_origin", "merchant_id", "expected_transfer_account_id" FROM `transactions`;--> statement-breakpoint
DROP TABLE `transactions`;--> statement-breakpoint
ALTER TABLE `__new_transactions` RENAME TO `transactions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `transactions_category` ON `transactions` (`category_id`);--> statement-breakpoint
CREATE INDEX `transactions_merchant` ON `transactions` (`merchant_id`);--> statement-breakpoint
-- Added by hand: each lock now keeps its time, as Sure's `locked_attributes`
-- (Story 27.18). A lock set before this migration has no known time, so its
-- field maps to null and the sheet names it without a date.
UPDATE `transactions` SET `locked_fields` = (
	SELECT json_group_object(`value`, NULL) FROM json_each(`transactions`.`locked_fields`)
) WHERE json_type(`locked_fields`) = 'array';
