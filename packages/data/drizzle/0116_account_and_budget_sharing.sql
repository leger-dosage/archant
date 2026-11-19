CREATE TABLE `account_shares` (
	`account_id` text NOT NULL,
	`user_id` text NOT NULL,
	`permission` text NOT NULL,
	`include_in_finances` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`account_id`, `user_id`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "account_shares_permission_check" CHECK("account_shares"."permission" in ('full_control', 'read_write', 'read_only'))
);
--> statement-breakpoint
CREATE INDEX `account_shares_user` ON `account_shares` (`user_id`);--> statement-breakpoint
CREATE TABLE `budget_shares` (
	`owner_id` text NOT NULL,
	`viewer_id` text NOT NULL,
	`permission` text NOT NULL,
	PRIMARY KEY(`owner_id`, `viewer_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`viewer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "budget_shares_permission_check" CHECK("budget_shares"."permission" in ('read_write', 'read_only')),
	CONSTRAINT "budget_shares_distinct_users" CHECK("budget_shares"."owner_id" != "budget_shares"."viewer_id")
);
--> statement-breakpoint
CREATE INDEX `budget_shares_viewer` ON `budget_shares` (`viewer_id`);--> statement-breakpoint
DROP INDEX `budgets_month_unique`;--> statement-breakpoint
DROP INDEX `budgets_start_date_unique`;--> statement-breakpoint
DROP INDEX `budgets_end_date_unique`;--> statement-breakpoint
ALTER TABLE `budgets` ADD `owner_id` text REFERENCES users(id) ON DELETE CASCADE;--> statement-breakpoint
CREATE UNIQUE INDEX `budgets_owner_month_unique` ON `budgets` (`owner_id`,`month`);--> statement-breakpoint
CREATE UNIQUE INDEX `budgets_owner_start_date_unique` ON `budgets` (`owner_id`,`start_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `budgets_owner_end_date_unique` ON `budgets` (`owner_id`,`end_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `budgets_month_unique` ON `budgets` (`month`) WHERE "budgets"."owner_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `budgets_start_date_unique` ON `budgets` (`start_date`) WHERE "budgets"."owner_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `budgets_end_date_unique` ON `budgets` (`end_date`) WHERE "budgets"."owner_id" is null;--> statement-breakpoint
ALTER TABLE `accounts` ADD `owner_id` text REFERENCES users(id) ON DELETE RESTRICT;--> statement-breakpoint
CREATE INDEX `accounts_owner` ON `accounts` (`owner_id`);--> statement-breakpoint
-- Match Sure's shared-by-default bootstrap for members already in the household.
UPDATE accounts
SET owner_id = (SELECT id FROM users ORDER BY (role = 'admin') DESC, created_at, id LIMIT 1);
--> statement-breakpoint
INSERT INTO account_shares (account_id, user_id, permission)
SELECT accounts.id, users.id, CASE WHEN users.role = 'guest' THEN 'read_only' ELSE 'read_write' END
FROM accounts CROSS JOIN users
WHERE accounts.owner_id <> users.id;
--> statement-breakpoint
ALTER TABLE `rule_runs` ADD `actor_id` text;--> statement-breakpoint
ALTER TABLE `rules` ADD `author_id` text;
--> statement-breakpoint
-- Existing rules belong to the household that used them before sharing.
UPDATE rules SET author_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at, id LIMIT 1);
--> statement-breakpoint
UPDATE rule_runs SET actor_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at, id LIMIT 1);
