PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_rule_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_id` text,
	`rule` text NOT NULL,
	`execution_type` text NOT NULL,
	`status` text NOT NULL,
	`transactions_queued` integer NOT NULL,
	`transactions_processed` integer NOT NULL,
	`transactions_modified` integer NOT NULL,
	`error_message` text,
	`executed_at` integer NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "rule_runs_execution_type_check" CHECK("__new_rule_runs"."execution_type" in ('manual', 'scheduled')),
	CONSTRAINT "rule_runs_status_check" CHECK("__new_rule_runs"."status" in ('pending', 'success', 'failed'))
);
--> statement-breakpoint
INSERT INTO `__new_rule_runs`("id", "rule_id", "rule", "execution_type", "status", "transactions_queued", "transactions_processed", "transactions_modified", "error_message", "executed_at", "position") SELECT "id", "rule_id", "rule", 'manual', 'success', "matched_count", "matched_count", "changed_count", NULL, "executed_at", "position" FROM `rule_runs`;--> statement-breakpoint
DROP TABLE `rule_runs`;--> statement-breakpoint
ALTER TABLE `__new_rule_runs` RENAME TO `rule_runs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `rule_runs_executed` ON `rule_runs` (`executed_at`,`position`);
