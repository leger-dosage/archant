PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`outflow_transaction_id` text NOT NULL,
	`inflow_transaction_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`outflow_transaction_id`) REFERENCES `transactions`(`entry_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`inflow_transaction_id`) REFERENCES `transactions`(`entry_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "transfers_distinct_sides_check" CHECK("__new_transfers"."outflow_transaction_id" <> "__new_transfers"."inflow_transaction_id"),
	CONSTRAINT "transfers_kind_check" CHECK("__new_transfers"."kind" in ('internal_move', 'credit_card_payment', 'loan_payment', 'investment_contribution')),
	CONSTRAINT "transfers_status_check" CHECK("__new_transfers"."status" in ('pending', 'confirmed'))
);
--> statement-breakpoint
INSERT INTO `__new_transfers`("id", "outflow_transaction_id", "inflow_transaction_id", "kind", "status", "created_at") SELECT "id", "outflow_transaction_id", "inflow_transaction_id", "kind", 'pending', "created_at" FROM `transfers`;--> statement-breakpoint
DROP TABLE `transfers`;--> statement-breakpoint
ALTER TABLE `__new_transfers` RENAME TO `transfers`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `transfers_outflow_unique` ON `transfers` (`outflow_transaction_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `transfers_inflow_unique` ON `transfers` (`inflow_transaction_id`);