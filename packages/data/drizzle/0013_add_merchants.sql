CREATE TABLE `merchants` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merchants_name_unique` ON `merchants` (lower("name"));--> statement-breakpoint
-- `ON DELETE restrict` added by hand: drizzle-kit leaves it out of an added column.
ALTER TABLE `transactions` ADD `merchant_id` text REFERENCES merchants(id) ON DELETE restrict;--> statement-breakpoint
CREATE INDEX `transactions_merchant` ON `transactions` (`merchant_id`);