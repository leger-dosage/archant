ALTER TABLE `transactions` ADD `pending` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `pending_missed_syncs` integer DEFAULT 0 NOT NULL;