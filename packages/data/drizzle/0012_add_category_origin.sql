PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_transactions` (
	`entry_id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`notes` text,
	`reference` text,
	`excluded` integer DEFAULT false NOT NULL,
	`possible_duplicate` integer DEFAULT false NOT NULL,
	`locked_fields` text DEFAULT '[]' NOT NULL,
	`category_id` text,
	`category_origin` text,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "transactions_category_origin_check" CHECK("__new_transactions"."category_origin" in ('user', 'rule', 'provider')),
	CONSTRAINT "transactions_category_origin_set_check" CHECK(("__new_transactions"."category_id" is null) = ("__new_transactions"."category_origin" is null))
);
--> statement-breakpoint
-- Edited by hand: drizzle-kit read `category_origin` from the old table, which has
-- none. Before this migration only a person could set a category, directly in the
-- database, so a categorised row takes `user`, with the lock that goes with it,
-- rather than failing the new check.
INSERT INTO `__new_transactions`("entry_id", "label", "notes", "reference", "excluded", "possible_duplicate", "locked_fields", "category_id", "category_origin") SELECT "entry_id", "label", "notes", "reference", "excluded", "possible_duplicate", CASE WHEN "category_id" IS NULL THEN "locked_fields" ELSE json_insert("locked_fields", '$[#]', 'category') END, "category_id", CASE WHEN "category_id" IS NULL THEN NULL ELSE 'user' END FROM `transactions`;--> statement-breakpoint
DROP TABLE `transactions`;--> statement-breakpoint
ALTER TABLE `__new_transactions` RENAME TO `transactions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `transactions_category` ON `transactions` (`category_id`);