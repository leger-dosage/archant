ALTER TABLE `transactions` ADD `excluded` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `entries_kind_date` ON `entries` (`kind`,`date`,`created_at`,`id`);