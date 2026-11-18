CREATE TABLE `goal_deposits` (
	`entry_id` text PRIMARY KEY NOT NULL,
	`snapshot_delta` integer,
	`claimed` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "goal_deposits_snapshot_delta_check" CHECK("goal_deposits"."snapshot_delta" > 0)
);
--> statement-breakpoint
CREATE INDEX `goal_deposits_claimed` ON `goal_deposits` (`claimed`);--> statement-breakpoint
CREATE TABLE `goal_pledges` (
	`id` text PRIMARY KEY NOT NULL,
	`goal_id` text NOT NULL,
	`account_id` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`matched_date` text,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "goal_pledges_amount_check" CHECK("goal_pledges"."amount" > 0),
	CONSTRAINT "goal_pledges_status_check" CHECK("goal_pledges"."status" in ('open', 'matched', 'cancelled')),
	CONSTRAINT "goal_pledges_match_check" CHECK("goal_pledges"."matched_date" is null or "goal_pledges"."status" = 'matched')
);
--> statement-breakpoint
CREATE INDEX `goal_pledges_goal` ON `goal_pledges` (`goal_id`);--> statement-breakpoint
CREATE INDEX `goal_pledges_account_status` ON `goal_pledges` (`account_id`,`status`,`expires_at`);