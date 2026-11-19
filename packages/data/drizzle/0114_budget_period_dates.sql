CREATE TABLE `__new_budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`month` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`currency` text NOT NULL,
	`budgeted_spending` integer,
	`expected_income` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "budgets_dates_check" CHECK(substr("__new_budgets"."start_date", 1, 7) = "__new_budgets"."month" and "__new_budgets"."end_date" >= "__new_budgets"."start_date"),
	CONSTRAINT "budgets_amounts_check" CHECK("__new_budgets"."budgeted_spending" >= 0 and "__new_budgets"."expected_income" >= 0)
);
--> statement-breakpoint
-- Existing budgets always used calendar months, regardless of the stored preference.
INSERT INTO `__new_budgets`("id", "month", "start_date", "end_date", "currency", "budgeted_spending", "expected_income", "created_at", "updated_at")
SELECT "id", "month", "month" || '-01', CASE WHEN "month" = '9999-12' THEN '9999-12-31' ELSE date("month" || '-01', '+1 month', '-1 day') END,
       "currency", "budgeted_spending", "expected_income", "created_at", "updated_at"
FROM `budgets`;--> statement-breakpoint
DROP TABLE `budgets`;--> statement-breakpoint
ALTER TABLE `__new_budgets` RENAME TO `budgets`;--> statement-breakpoint
CREATE UNIQUE INDEX `budgets_month_unique` ON `budgets` (`month`);--> statement-breakpoint
CREATE UNIQUE INDEX `budgets_start_date_unique` ON `budgets` (`start_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `budgets_end_date_unique` ON `budgets` (`end_date`);
