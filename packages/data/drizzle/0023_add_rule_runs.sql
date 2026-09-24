CREATE TABLE `rule_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_id` text,
	`rule` text NOT NULL,
	`matched_count` integer NOT NULL,
	`changed_count` integer NOT NULL,
	`executed_at` integer NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `rule_runs_executed` ON `rule_runs` (`executed_at`,`position`);