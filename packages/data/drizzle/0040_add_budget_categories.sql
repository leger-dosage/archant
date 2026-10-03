CREATE TABLE `budget_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`budget_id` text NOT NULL,
	`category_id` text NOT NULL,
	`budgeted_spending` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`budget_id`) REFERENCES `budgets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "budget_categories_amount_check" CHECK("budget_categories"."budgeted_spending" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budget_categories_budget_category_unique` ON `budget_categories` (`budget_id`,`category_id`);--> statement-breakpoint
CREATE INDEX `budget_categories_category` ON `budget_categories` (`category_id`);