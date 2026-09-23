CREATE TABLE `rejected_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`outflow_transaction_id` text NOT NULL,
	`inflow_transaction_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`outflow_transaction_id`) REFERENCES `transactions`(`entry_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`inflow_transaction_id`) REFERENCES `transactions`(`entry_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "rejected_transfers_distinct_sides_check" CHECK("rejected_transfers"."outflow_transaction_id" <> "rejected_transfers"."inflow_transaction_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rejected_transfers_pair_unique` ON `rejected_transfers` (`outflow_transaction_id`,`inflow_transaction_id`);--> statement-breakpoint
CREATE INDEX `rejected_transfers_inflow` ON `rejected_transfers` (`inflow_transaction_id`);