-- Rebuild both role constraints while preserving sessions and other rows that reference users.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`role` text NOT NULL,
	`banned` integer DEFAULT false,
	`ban_reason` text,
	`ban_expires` integer,
	`two_factor_enabled` integer DEFAULT false,
	`default_account_id` text,
	`default_account_order` text DEFAULT 'name_asc' NOT NULL,
	`default_period` text DEFAULT 'last_30_days' NOT NULL,
	`locale` text,
	`show_split_grouped` integer DEFAULT true NOT NULL,
	`rule_prompts_disabled` integer DEFAULT false NOT NULL,
	`rule_prompt_dismissed_at` integer,
	`dashboard_layout` text,
	`reports_layout` text,
	FOREIGN KEY (`default_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "users_role_check" CHECK("__new_users"."role" in ('admin', 'member', 'guest')),
	CONSTRAINT "users_default_account_order_check" CHECK("__new_users"."default_account_order" in ('name_asc', 'name_desc', 'balance_asc', 'balance_desc')),
	CONSTRAINT "users_default_period_check" CHECK("__new_users"."default_period" in ('last_day', 'current_week', 'last_7_days', 'current_month', 'last_month', 'last_30_days', 'last_90_days', 'current_year', 'last_365_days', 'last_5_years', 'last_10_years', 'all_time')),
	CONSTRAINT "users_locale_check" CHECK("__new_users"."locale" is null or "__new_users"."locale" in ('en', 'fr'))
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "name", "email", "email_verified", "image", "created_at", "updated_at", "role", "banned", "ban_reason", "ban_expires", "two_factor_enabled", "default_account_id", "default_account_order", "default_period", "locale", "show_split_grouped", "rule_prompts_disabled", "rule_prompt_dismissed_at", "dashboard_layout", "reports_layout") SELECT "id", "name", "email", "email_verified", "image", "created_at", "updated_at", CASE "role" WHEN 'viewer' THEN 'guest' ELSE "role" END, "banned", "ban_reason", "ban_expires", "two_factor_enabled", "default_account_id", "default_account_order", "default_period", "locale", "show_split_grouped", "rule_prompts_disabled", "rule_prompt_dismissed_at", "dashboard_layout", "reports_layout" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `__new_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`token_hash` text NOT NULL,
	`inviter_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`inviter_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "invitations_role_check" CHECK("__new_invitations"."role" in ('admin', 'member', 'guest'))
);
--> statement-breakpoint
INSERT INTO `__new_invitations`("id", "email", "role", "token_hash", "inviter_id", "expires_at", "accepted_at", "created_at") SELECT "id", "email", CASE "role" WHEN 'viewer' THEN 'guest' ELSE "role" END, "token_hash", "inviter_id", "expires_at", "accepted_at", "created_at" FROM `invitations`;--> statement-breakpoint
DROP TABLE `invitations`;--> statement-breakpoint
ALTER TABLE `__new_invitations` RENAME TO `invitations`;--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_token_hash_unique` ON `invitations` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_pending_email_unique` ON `invitations` (`email`) WHERE "invitations"."accepted_at" is null;--> statement-breakpoint
CREATE INDEX `invitations_inviter_id` ON `invitations` (`inviter_id`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
