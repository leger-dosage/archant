PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_rule_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_id` text NOT NULL,
	`position` integer NOT NULL,
	`action_type` text NOT NULL,
	`value` text,
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "rule_actions_type_check" CHECK("__new_rule_actions"."action_type" in ('set_transaction_category', 'set_transaction_merchant', 'set_transaction_tags', 'set_transaction_name', 'exclude_transaction', 'set_as_transfer_or_payment'))
);
--> statement-breakpoint
INSERT INTO `__new_rule_actions`("id", "rule_id", "position", "action_type", "value") SELECT "id", "rule_id", "position", "action_type", "value" FROM `rule_actions`;--> statement-breakpoint
DROP TABLE `rule_actions`;--> statement-breakpoint
ALTER TABLE `__new_rule_actions` RENAME TO `rule_actions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `rule_actions_rule` ON `rule_actions` (`rule_id`);--> statement-breakpoint
CREATE TABLE `__new_rule_conditions` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_id` text NOT NULL,
	`parent_id` text,
	`position` integer NOT NULL,
	`condition_type` text NOT NULL,
	`operator` text NOT NULL,
	`value` text,
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `rule_conditions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "rule_conditions_type_check" CHECK("__new_rule_conditions"."condition_type" in ('transaction_name', 'transaction_amount', 'transaction_account', 'transaction_merchant', 'transaction_category', 'transaction_tag', 'transaction_notes', 'transaction_type', 'compound')),
	CONSTRAINT "rule_conditions_operator_check" CHECK("__new_rule_conditions"."operator" in ('like', '=', '>', '>=', '<', '<=', '!=', 'and', 'or', 'is_null')),
	CONSTRAINT "rule_conditions_operator_of_type_check" CHECK(("__new_rule_conditions"."condition_type" = 'transaction_name' and "__new_rule_conditions"."operator" in ('like', '=')) or ("__new_rule_conditions"."condition_type" = 'transaction_amount' and "__new_rule_conditions"."operator" in ('>', '>=', '<', '<=', '=', '!=')) or ("__new_rule_conditions"."condition_type" = 'transaction_account' and "__new_rule_conditions"."operator" in ('=')) or ("__new_rule_conditions"."condition_type" = 'transaction_merchant' and "__new_rule_conditions"."operator" in ('=', 'is_null')) or ("__new_rule_conditions"."condition_type" = 'transaction_category' and "__new_rule_conditions"."operator" in ('=', 'is_null')) or ("__new_rule_conditions"."condition_type" = 'transaction_tag' and "__new_rule_conditions"."operator" in ('=', 'is_null')) or ("__new_rule_conditions"."condition_type" = 'transaction_notes' and "__new_rule_conditions"."operator" in ('like', '=', 'is_null')) or ("__new_rule_conditions"."condition_type" = 'transaction_type' and "__new_rule_conditions"."operator" in ('=')) or ("__new_rule_conditions"."condition_type" = 'compound' and "__new_rule_conditions"."operator" in ('and', 'or')))
);
--> statement-breakpoint
INSERT INTO `__new_rule_conditions`("id", "rule_id", "parent_id", "position", "condition_type", "operator", "value") SELECT "id", "rule_id", "parent_id", "position", "condition_type", "operator", "value" FROM `rule_conditions`;--> statement-breakpoint
DROP TABLE `rule_conditions`;--> statement-breakpoint
ALTER TABLE `__new_rule_conditions` RENAME TO `rule_conditions`;--> statement-breakpoint
CREATE INDEX `rule_conditions_rule` ON `rule_conditions` (`rule_id`);--> statement-breakpoint
CREATE INDEX `rule_conditions_parent` ON `rule_conditions` (`parent_id`);--> statement-breakpoint
-- `ON DELETE set null` added by hand: drizzle-kit leaves it out of an added column.
ALTER TABLE `transactions` ADD `expected_transfer_account_id` text REFERENCES accounts(id) ON DELETE set null;