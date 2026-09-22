ALTER TABLE `accounts` ADD `active` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `accounts` ADD `excluded_from_reports` integer DEFAULT false NOT NULL;