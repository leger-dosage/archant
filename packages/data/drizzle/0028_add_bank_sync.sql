PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_entry_keys` (
	`entry_id` text NOT NULL,
	`account_id` text NOT NULL,
	`source` text NOT NULL,
	`key` text NOT NULL,
	`import_id` text,
	`connection_id` text,
	PRIMARY KEY(`account_id`, `source`, `key`),
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`connection_id`) REFERENCES `bank_connections`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "entry_keys_source_check" CHECK("__new_entry_keys"."source" in ('ofx', 'csv', 'qif', 'enable-banking'))
);
--> statement-breakpoint
-- drizzle-kit copies `connection_id` from the old table, which never had it.
INSERT INTO `__new_entry_keys`("entry_id", "account_id", "source", "key", "import_id") SELECT "entry_id", "account_id", "source", "key", "import_id" FROM `entry_keys`;--> statement-breakpoint
DROP TABLE `entry_keys`;--> statement-breakpoint
ALTER TABLE `__new_entry_keys` RENAME TO `entry_keys`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `entry_keys_entry` ON `entry_keys` (`entry_id`);--> statement-breakpoint
CREATE INDEX `entry_keys_import` ON `entry_keys` (`import_id`);--> statement-breakpoint
CREATE INDEX `entry_keys_connection` ON `entry_keys` (`connection_id`);--> statement-breakpoint
ALTER TABLE `bank_accounts` ADD `last_synced_at` integer;--> statement-breakpoint
ALTER TABLE `bank_connections` ADD `last_synced_at` integer;--> statement-breakpoint
ALTER TABLE `bank_connections` ADD `last_error` text;--> statement-breakpoint
ALTER TABLE `bank_connections` ADD `sync_started_at` integer;