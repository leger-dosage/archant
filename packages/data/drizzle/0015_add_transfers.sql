CREATE TABLE `transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`outflow_transaction_id` text NOT NULL,
	`inflow_transaction_id` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`outflow_transaction_id`) REFERENCES `transactions`(`entry_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`inflow_transaction_id`) REFERENCES `transactions`(`entry_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "transfers_distinct_sides_check" CHECK("transfers"."outflow_transaction_id" <> "transfers"."inflow_transaction_id"),
	CONSTRAINT "transfers_kind_check" CHECK("transfers"."kind" in ('internal_move', 'credit_card_payment', 'loan_payment', 'investment_contribution'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transfers_outflow_unique` ON `transfers` (`outflow_transaction_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `transfers_inflow_unique` ON `transfers` (`inflow_transaction_id`);