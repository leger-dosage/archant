CREATE TABLE `deleted_entry_keys` (
	`account_id` text NOT NULL,
	`source` text NOT NULL,
	`key` text NOT NULL,
	`deleted_at` integer NOT NULL,
	PRIMARY KEY(`account_id`, `source`, `key`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "deleted_entry_keys_source_check" CHECK("deleted_entry_keys"."source" in ('enable-banking'))
);
