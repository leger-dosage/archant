PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_budget_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`budget_id` text NOT NULL,
	`category_id` text NOT NULL,
	`budgeted_spending` integer NOT NULL,
	`rollover_enabled` integer DEFAULT false NOT NULL,
	`rolled_over_amount` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`budget_id`) REFERENCES `budgets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "budget_categories_amount_check" CHECK("__new_budget_categories"."budgeted_spending" >= 0),
	CONSTRAINT "budget_categories_rolled_over_check" CHECK("__new_budget_categories"."rolled_over_amount" >= 0)
);
--> statement-breakpoint
-- Edited by hand: drizzle-kit read `rollover_enabled` and `rolled_over_amount` from
-- the old table, which has neither, and SQLite would have stored their names as text.
-- No category carried anything before this story.
INSERT INTO `__new_budget_categories`("id", "budget_id", "category_id", "budgeted_spending", "rollover_enabled", "rolled_over_amount", "created_at", "updated_at") SELECT "id", "budget_id", "category_id", "budgeted_spending", false, 0, "created_at", "updated_at" FROM `budget_categories`;--> statement-breakpoint
DROP TABLE `budget_categories`;--> statement-breakpoint
ALTER TABLE `__new_budget_categories` RENAME TO `budget_categories`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `budget_categories_budget_category_unique` ON `budget_categories` (`budget_id`,`category_id`);--> statement-breakpoint
CREATE INDEX `budget_categories_category` ON `budget_categories` (`category_id`);