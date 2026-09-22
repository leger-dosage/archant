PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
	`reverted_at` integer,
	`previous_opening_date` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "imports_source_check" CHECK("__new_imports"."source" in ('ofx', 'csv', 'qif')),
	CONSTRAINT "imports_status_check" CHECK("__new_imports"."status" in ('previewed', 'confirmed', 'reverted'))
);
--> statement-breakpoint
INSERT INTO `__new_imports`("id", "account_id", "source", "file_name", "status", "content", "options", "preview_digest", "counts", "created_at", "confirmed_at") SELECT "id", "account_id", "source", "file_name", "status", "content", "options", "preview_digest", "counts", "created_at", "confirmed_at" FROM `imports`;--> statement-breakpoint
DROP TABLE `imports`;--> statement-breakpoint
ALTER TABLE `__new_imports` RENAME TO `imports`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `imports_account` ON `imports` (`account_id`);--> statement-breakpoint
CREATE INDEX `imports_status_created` ON `imports` (`status`,`created_at`);