CREATE TABLE `transactions` (
	`entry_id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`notes` text,
	`locked_fields` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE restrict
);
