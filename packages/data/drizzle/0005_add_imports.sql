CREATE TABLE `entry_keys` (
	`entry_id` text NOT NULL,
	`account_id` text NOT NULL,
	`source` text NOT NULL,
	`key` text NOT NULL,
	`import_id` text,
	PRIMARY KEY(`account_id`, `source`, `key`),
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "entry_keys_source_check" CHECK("entry_keys"."source" in ('ofx'))
);
--> statement-breakpoint
CREATE INDEX `entry_keys_entry` ON `entry_keys` (`entry_id`);--> statement-breakpoint
CREATE INDEX `entry_keys_import` ON `entry_keys` (`import_id`);--> statement-breakpoint
CREATE TABLE `imports` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`source` text NOT NULL,
	`file_name` text NOT NULL,
	`status` text NOT NULL,
	`content` blob NOT NULL,
	`options` text NOT NULL,
	`preview_digest` text,
	`counts` text,
	`created_at` integer NOT NULL,
	`confirmed_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "imports_source_check" CHECK("imports"."source" in ('ofx')),
	CONSTRAINT "imports_status_check" CHECK("imports"."status" in ('previewed', 'confirmed'))
);
--> statement-breakpoint
CREATE INDEX `imports_account` ON `imports` (`account_id`);--> statement-breakpoint
CREATE INDEX `imports_status_created` ON `imports` (`status`,`created_at`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `possible_duplicate` integer DEFAULT false NOT NULL;