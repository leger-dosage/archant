CREATE TABLE `transfer_fees` (
	`transaction_id` text PRIMARY KEY NOT NULL,
	`transfer_id` text NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`entry_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transfer_id`) REFERENCES `transfers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `transfer_fees_transfer` ON `transfer_fees` (`transfer_id`);--> statement-breakpoint
ALTER TABLE `transfers` ADD `idempotency_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `transfers_idempotency_key_unique` ON `transfers` (`idempotency_key`) WHERE "transfers"."idempotency_key" is not null;