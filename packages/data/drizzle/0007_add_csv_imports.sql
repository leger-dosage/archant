CREATE TABLE `import_mappings` (
	`account_id` text PRIMARY KEY NOT NULL,
	`mapping` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_entry_keys` (
	`entry_id` text NOT NULL,
	`account_id` text NOT NULL,
	`source` text NOT NULL,
	`key` text NOT NULL,
	`import_id` text,
	PRIMARY KEY(`account_id`, `source`, `key`),
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "entry_keys_source_check" CHECK("__new_entry_keys"."source" in ('ofx', 'csv'))
);
--> statement-breakpoint
INSERT INTO `__new_entry_keys`("entry_id", "account_id", "source", "key", "import_id") SELECT "entry_id", "account_id", "source", "key", "import_id" FROM `entry_keys`;--> statement-breakpoint
DROP TABLE `entry_keys`;--> statement-breakpoint
ALTER TABLE `__new_entry_keys` RENAME TO `entry_keys`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `entry_keys_entry` ON `entry_keys` (`entry_id`);--> statement-breakpoint
CREATE INDEX `entry_keys_import` ON `entry_keys` (`import_id`);--> statement-breakpoint
CREATE TABLE `__new_imports` (
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
	CONSTRAINT "imports_source_check" CHECK("__new_imports"."source" in ('ofx', 'csv')),
	CONSTRAINT "imports_status_check" CHECK("__new_imports"."status" in ('previewed', 'confirmed'))
);
--> statement-breakpoint
INSERT INTO `__new_imports`("id", "account_id", "source", "file_name", "status", "content", "options", "preview_digest", "counts", "created_at", "confirmed_at") SELECT "id", "account_id", "source", "file_name", "status", "content", "options", "preview_digest", "counts", "created_at", "confirmed_at" FROM `imports`;--> statement-breakpoint
DROP TABLE `imports`;--> statement-breakpoint
ALTER TABLE `__new_imports` RENAME TO `imports`;--> statement-breakpoint
CREATE INDEX `imports_account` ON `imports` (`account_id`);--> statement-breakpoint
CREATE INDEX `imports_status_created` ON `imports` (`status`,`created_at`);