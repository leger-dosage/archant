CREATE TABLE `bank_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`bank_connection_id` text NOT NULL,
	`identification_hash` text NOT NULL,
	`provider_uid` text NOT NULL,
	`name` text NOT NULL,
	`iban_last4` text,
	`currency` text NOT NULL,
	`cash_account_type` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`bank_connection_id`) REFERENCES `bank_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_accounts_connection_hash_unique` ON `bank_accounts` (`bank_connection_id`,`identification_hash`);--> statement-breakpoint
-- drizzle-kit drops the `on delete` clause of a column it adds: without it,
-- deleting a connection would fail on every account it feeds.
ALTER TABLE `accounts` ADD `bank_account_id` text REFERENCES bank_accounts(id) ON DELETE set null;--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_bank_account_unique` ON `accounts` (`bank_account_id`);