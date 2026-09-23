CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`color` text NOT NULL,
	`icon` text NOT NULL,
	`parent_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "categories_kind_check" CHECK("categories"."kind" in ('income', 'expense'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_name_unique` ON `categories` (lower("name"));--> statement-breakpoint
CREATE INDEX `categories_parent` ON `categories` (`parent_id`);--> statement-breakpoint
-- `ON DELETE restrict` added by hand: drizzle-kit leaves it out of an added column.
ALTER TABLE `transactions` ADD `category_id` text REFERENCES categories(id) ON DELETE restrict;--> statement-breakpoint
CREATE INDEX `transactions_category` ON `transactions` (`category_id`);