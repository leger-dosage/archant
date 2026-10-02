PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_rule_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_id` text NOT NULL,
	`position` integer NOT NULL,
	`action_type` text NOT NULL,
	`value` text,
	`replacement` text,
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "rule_actions_type_check" CHECK("__new_rule_actions"."action_type" in ('set_transaction_category', 'set_transaction_merchant', 'set_transaction_tags', 'set_transaction_name', 'replace_in_transaction_name', 'exclude_transaction', 'set_as_transfer_or_payment'))
);
--> statement-breakpoint
-- Edited by hand: drizzle-kit read `replacement` from the old table, which has none.
INSERT INTO `__new_rule_actions`("id", "rule_id", "position", "action_type", "value") SELECT "id", "rule_id", "position", "action_type", "value" FROM `rule_actions`;--> statement-breakpoint
DROP TABLE `rule_actions`;--> statement-breakpoint
ALTER TABLE `__new_rule_actions` RENAME TO `rule_actions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `rule_actions_rule` ON `rule_actions` (`rule_id`);