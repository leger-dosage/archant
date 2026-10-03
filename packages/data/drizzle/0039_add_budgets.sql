CREATE TABLE `budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`month` text NOT NULL,
	`currency` text NOT NULL,
	`budgeted_spending` integer,
	`expected_income` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "budgets_amounts_check" CHECK("budgets"."budgeted_spending" >= 0 and "budgets"."expected_income" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budgets_month_unique` ON `budgets` (`month`);