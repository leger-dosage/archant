-- No hour between two syncs any more (Story 29.9): only a held lease makes a
-- sync wait, so the renewal's exception to that hour goes.
ALTER TABLE `bank_connections` DROP COLUMN `authorized_at`;--> statement-breakpoint
ALTER TABLE `bank_connections` ADD `required_psu_headers` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `bank_connections` ADD `psu_ip_address` text;
