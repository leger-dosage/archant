CREATE TABLE `sso_audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`user_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "sso_audit_logs_event_type_check" CHECK("sso_audit_logs"."event_type" in ('login', 'login_failed', 'link', 'unlink', 'jit_account_created'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_accounts_openid_identity` ON `auth_accounts` (`provider_id`,`account_id`) WHERE "auth_accounts"."provider_id" = 'openid-connect';--> statement-breakpoint
CREATE UNIQUE INDEX `auth_accounts_openid_user` ON `auth_accounts` (`user_id`) WHERE "auth_accounts"."provider_id" = 'openid-connect';