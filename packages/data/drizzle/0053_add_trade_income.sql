PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_trades` (
	`entry_id` text PRIMARY KEY NOT NULL,
	`security_id` text,
	`income_kind` text,
	`quantity` integer NOT NULL,
	`price` integer NOT NULL,
	`fee` integer NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "trades_income_kind_check" CHECK("__new_trades"."income_kind" is null or "__new_trades"."income_kind" in ('dividend', 'interest')),
	CONSTRAINT "trades_quantity_check" CHECK(("__new_trades"."income_kind" is null and "__new_trades"."quantity" <> 0) or ("__new_trades"."income_kind" is not null and "__new_trades"."quantity" = 0)),
	CONSTRAINT "trades_price_check" CHECK("__new_trades"."price" >= 0),
	CONSTRAINT "trades_fee_check" CHECK("__new_trades"."fee" >= 0),
	CONSTRAINT "trades_income_figures_check" CHECK("__new_trades"."income_kind" is null or ("__new_trades"."price" = 0 and "__new_trades"."fee" = 0)),
	CONSTRAINT "trades_security_check" CHECK("__new_trades"."security_id" is not null or ("__new_trades"."income_kind" is not null and "__new_trades"."income_kind" = 'interest'))
);
--> statement-breakpoint
INSERT INTO `__new_trades`("entry_id", "security_id", "income_kind", "quantity", "price", "fee") SELECT "entry_id", "security_id", NULL, "quantity", "price", "fee" FROM `trades`;--> statement-breakpoint
DROP TABLE `trades`;--> statement-breakpoint
ALTER TABLE `__new_trades` RENAME TO `trades`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `trades_security` ON `trades` (`security_id`);