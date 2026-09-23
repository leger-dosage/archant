CREATE TABLE `rule_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_id` text NOT NULL,
	`position` integer NOT NULL,
	`action_type` text NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "rule_actions_type_check" CHECK("rule_actions"."action_type" in ('set_transaction_category'))
);
--> statement-breakpoint
CREATE INDEX `rule_actions_rule` ON `rule_actions` (`rule_id`);--> statement-breakpoint
CREATE TABLE `rule_conditions` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_id` text NOT NULL,
	`parent_id` text,
	`position` integer NOT NULL,
	`condition_type` text NOT NULL,
	`operator` text NOT NULL,
	`value` text,
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `rule_conditions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "rule_conditions_type_check" CHECK("rule_conditions"."condition_type" in ('transaction_name', 'transaction_amount', 'transaction_account', 'compound')),
	CONSTRAINT "rule_conditions_operator_check" CHECK("rule_conditions"."operator" in ('like', '=', '>', '>=', '<', '<=', '!=', 'and', 'or')),
	CONSTRAINT "rule_conditions_operator_of_type_check" CHECK(("rule_conditions"."condition_type" = 'transaction_name' and "rule_conditions"."operator" in ('like', '=')) or ("rule_conditions"."condition_type" = 'transaction_amount' and "rule_conditions"."operator" in ('>', '>=', '<', '<=', '=', '!=')) or ("rule_conditions"."condition_type" = 'transaction_account' and "rule_conditions"."operator" in ('=')) or ("rule_conditions"."condition_type" = 'compound' and "rule_conditions"."operator" in ('and', 'or')))
);
--> statement-breakpoint
CREATE INDEX `rule_conditions_rule` ON `rule_conditions` (`rule_id`);--> statement-breakpoint
CREATE INDEX `rule_conditions_parent` ON `rule_conditions` (`parent_id`);--> statement-breakpoint
CREATE TABLE `rules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`enabled` integer DEFAULT true NOT NULL,
	`effective_date` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
