ALTER TABLE `bank_accounts` ADD `listed` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `bank_connections` ADD `authorization_started_at` integer;--> statement-breakpoint
ALTER TABLE `bank_connections` ADD `authorized_at` integer;