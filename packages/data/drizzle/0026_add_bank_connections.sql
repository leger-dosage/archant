CREATE TABLE `bank_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`connector` text NOT NULL,
	`institution_name` text NOT NULL,
	`country` text NOT NULL,
	`status` text NOT NULL,
	`authorization_state` text,
	`session_id` text,
	`consent_expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "bank_connections_connector_check" CHECK("bank_connections"."connector" in ('enable-banking')),
	CONSTRAINT "bank_connections_status_check" CHECK("bank_connections"."status" in ('pending', 'active'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_connections_authorization_state_unique` ON `bank_connections` (`authorization_state`);