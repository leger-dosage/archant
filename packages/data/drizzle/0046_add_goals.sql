CREATE TABLE `goal_accounts` (
	`goal_id` text NOT NULL,
	`account_id` text NOT NULL,
	`allocated_amount` integer,
	PRIMARY KEY(`goal_id`, `account_id`),
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "goal_accounts_allocated_amount_check" CHECK("goal_accounts"."allocated_amount" >= 0)
);
--> statement-breakpoint
CREATE INDEX `goal_accounts_account` ON `goal_accounts` (`account_id`);--> statement-breakpoint
CREATE TABLE `goals` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`target_amount` integer NOT NULL,
	`currency` text NOT NULL,
	`target_date` text,
	`color` text NOT NULL,
	`icon` text NOT NULL,
	`notes` text,
	`state` text DEFAULT 'active' NOT NULL,
	`kind` text DEFAULT 'one_off' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "goals_target_amount_check" CHECK("goals"."target_amount" > 0),
	CONSTRAINT "goals_state_check" CHECK("goals"."state" in ('active', 'paused', 'completed', 'archived')),
	CONSTRAINT "goals_kind_check" CHECK("goals"."kind" in ('one_off', 'maintained'))
);
