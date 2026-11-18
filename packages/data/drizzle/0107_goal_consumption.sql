ALTER TABLE `goals` ADD `consumed_amount` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `consumed_goal_id` text;