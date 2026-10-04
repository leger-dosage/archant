CREATE TABLE `trades` (
	`entry_id` text PRIMARY KEY NOT NULL,
	`security_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`price` integer NOT NULL,
	`fee` integer NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "trades_quantity_check" CHECK("trades"."quantity" <> 0),
	CONSTRAINT "trades_price_check" CHECK("trades"."price" >= 0),
	CONSTRAINT "trades_fee_check" CHECK("trades"."fee" >= 0)
);
--> statement-breakpoint
CREATE INDEX `trades_security` ON `trades` (`security_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`kind` text NOT NULL,
	`valuation_kind` text,
	`date` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`import_id` text,
	`parent_entry_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`parent_entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "entries_kind_check" CHECK("__new_entries"."kind" in ('transaction', 'valuation', 'trade')),
	CONSTRAINT "entries_valuation_kind_check" CHECK(("__new_entries"."kind" = 'valuation' and "__new_entries"."valuation_kind" is not null and "__new_entries"."valuation_kind" in ('opening_anchor', 'reconciliation', 'current_anchor')) or ("__new_entries"."kind" = 'transaction' and "__new_entries"."valuation_kind" is null) or ("__new_entries"."kind" = 'trade' and "__new_entries"."valuation_kind" is null))
);
--> statement-breakpoint
INSERT INTO `__new_entries`("id", "account_id", "kind", "valuation_kind", "date", "amount", "currency", "import_id", "parent_entry_id", "created_at", "updated_at") SELECT "id", "account_id", "kind", "valuation_kind", "date", "amount", "currency", "import_id", "parent_entry_id", "created_at", "updated_at" FROM `entries`;--> statement-breakpoint
DROP TABLE `entries`;--> statement-breakpoint
ALTER TABLE `__new_entries` RENAME TO `entries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `entries_one_opening_anchor` ON `entries` (`account_id`) WHERE "entries"."valuation_kind" = 'opening_anchor';--> statement-breakpoint
CREATE UNIQUE INDEX `entries_one_reconciliation_per_day` ON `entries` (`account_id`,`date`) WHERE "entries"."valuation_kind" = 'reconciliation';--> statement-breakpoint
CREATE INDEX `entries_account_date` ON `entries` (`account_id`,`date`);--> statement-breakpoint
CREATE INDEX `entries_import` ON `entries` (`import_id`);--> statement-breakpoint
CREATE INDEX `entries_parent_entry` ON `entries` (`parent_entry_id`) WHERE "entries"."parent_entry_id" is not null;--> statement-breakpoint
CREATE INDEX `entries_kind_date` ON `entries` (`kind`,`date`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `entries_kind_amount_date` ON `entries` (`kind`,`amount`,`date`);--> statement-breakpoint
CREATE INDEX `entries_kind_currency_amount` ON `entries` (`kind`,`currency`,`amount`,`id`);