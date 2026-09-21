CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`subtype` text,
	`currency` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "accounts_type_check" CHECK("accounts"."type" in ('depository', 'credit_card')),
	CONSTRAINT "accounts_subtype_check" CHECK(("accounts"."type" = 'depository' and "accounts"."subtype" is not null and "accounts"."subtype" in ('checking', 'savings')) or ("accounts"."type" = 'credit_card' and "accounts"."subtype" is null))
);
--> statement-breakpoint
CREATE TABLE `balances` (
	`account_id` text NOT NULL,
	`date` text NOT NULL,
	`balance` integer NOT NULL,
	`currency` text NOT NULL,
	PRIMARY KEY(`account_id`, `date`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `entries` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`kind` text NOT NULL,
	`valuation_kind` text,
	`date` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "entries_kind_check" CHECK("entries"."kind" in ('transaction', 'valuation')),
	CONSTRAINT "entries_valuation_kind_check" CHECK(("entries"."kind" = 'valuation' and "entries"."valuation_kind" is not null and "entries"."valuation_kind" in ('opening_anchor', 'reconciliation', 'current_anchor')) or ("entries"."kind" = 'transaction' and "entries"."valuation_kind" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entries_one_opening_anchor` ON `entries` (`account_id`) WHERE "entries"."valuation_kind" = 'opening_anchor';--> statement-breakpoint
CREATE INDEX `entries_account_date` ON `entries` (`account_id`,`date`);