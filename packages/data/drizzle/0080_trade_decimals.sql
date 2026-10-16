-- Quantities and trade prices were integers in millionths; they become
-- canonical decimal text (`decimals.ts`). Each integer is written as its exact
-- decimal in SQL, never through a float: the integer part, then the six
-- digits of the remainder less their trailing zeros. Holdings keep their
-- amounts and are not recomputed, since every value reads back the same.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_trades` (
	`entry_id` text PRIMARY KEY NOT NULL,
	`security_id` text,
	`income_kind` text,
	`quantity` text NOT NULL,
	`price` text NOT NULL,
	`fee` integer NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "trades_income_kind_check" CHECK("__new_trades"."income_kind" is null or "__new_trades"."income_kind" in ('dividend', 'interest')),
	CONSTRAINT "trades_quantity_check" CHECK(("__new_trades"."income_kind" is null and "__new_trades"."quantity" <> '0') or ("__new_trades"."income_kind" is not null and "__new_trades"."quantity" = '0')),
	CONSTRAINT "trades_price_check" CHECK("__new_trades"."price" not like '-%'),
	CONSTRAINT "trades_fee_check" CHECK("__new_trades"."fee" >= 0),
	CONSTRAINT "trades_income_figures_check" CHECK("__new_trades"."income_kind" is null or ("__new_trades"."price" = '0' and "__new_trades"."fee" = 0)),
	CONSTRAINT "trades_security_check" CHECK("__new_trades"."security_id" is not null or ("__new_trades"."income_kind" is not null and "__new_trades"."income_kind" = 'interest'))
);
--> statement-breakpoint
INSERT INTO `__new_trades`("entry_id", "security_id", "income_kind", "quantity", "price", "fee") SELECT "entry_id", "security_id", "income_kind", CASE WHEN "quantity" = 0 THEN '0' ELSE (CASE WHEN "quantity" < 0 THEN '-' ELSE '' END) || (abs("quantity") / 1000000) || (CASE WHEN abs("quantity") % 1000000 = 0 THEN '' ELSE '.' || rtrim(substr('000000' || (abs("quantity") % 1000000), -6), '0') END) END, CASE WHEN "price" = 0 THEN '0' ELSE (CASE WHEN "price" < 0 THEN '-' ELSE '' END) || (abs("price") / 1000000) || (CASE WHEN abs("price") % 1000000 = 0 THEN '' ELSE '.' || rtrim(substr('000000' || (abs("price") % 1000000), -6), '0') END) END, "fee" FROM `trades`;--> statement-breakpoint
DROP TABLE `trades`;--> statement-breakpoint
ALTER TABLE `__new_trades` RENAME TO `trades`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `trades_security` ON `trades` (`security_id`);--> statement-breakpoint
CREATE TABLE `__new_holdings` (
	`account_id` text NOT NULL,
	`security_id` text NOT NULL,
	`date` text NOT NULL,
	`quantity` text NOT NULL,
	`price` integer NOT NULL,
	`amount` integer NOT NULL,
	`cost_basis` integer,
	PRIMARY KEY(`account_id`, `date`, `security_id`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "holdings_price_check" CHECK("__new_holdings"."price" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_holdings`("account_id", "security_id", "date", "quantity", "price", "amount", "cost_basis") SELECT "account_id", "security_id", "date", CASE WHEN "quantity" = 0 THEN '0' ELSE (CASE WHEN "quantity" < 0 THEN '-' ELSE '' END) || (abs("quantity") / 1000000) || (CASE WHEN abs("quantity") % 1000000 = 0 THEN '' ELSE '.' || rtrim(substr('000000' || (abs("quantity") % 1000000), -6), '0') END) END, "price", "amount", "cost_basis" FROM `holdings`;--> statement-breakpoint
DROP TABLE `holdings`;--> statement-breakpoint
ALTER TABLE `__new_holdings` RENAME TO `holdings`;--> statement-breakpoint
CREATE INDEX `holdings_not_held` ON `holdings` (`account_id`,`security_id`,`date`,`quantity`) WHERE quantity = '0' or quantity like '-%';