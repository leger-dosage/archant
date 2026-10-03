CREATE TABLE `transaction_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`created_at` integer NOT NULL,
	`content` blob NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`entry_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "transaction_attachments_content_type_check" CHECK("transaction_attachments"."content_type" in ('image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'))
);
--> statement-breakpoint
CREATE INDEX `transaction_attachments_transaction` ON `transaction_attachments` (`transaction_id`);