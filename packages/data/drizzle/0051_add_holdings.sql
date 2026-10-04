CREATE TABLE `holdings` (
	`account_id` text NOT NULL,
	`security_id` text NOT NULL,
	`date` text NOT NULL,
	`quantity` integer NOT NULL,
	`price` integer NOT NULL,
	`amount` integer NOT NULL,
	`cost_basis` integer,
	PRIMARY KEY(`account_id`, `date`, `security_id`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "holdings_quantity_check" CHECK("holdings"."quantity" >= 0),
	CONSTRAINT "holdings_price_check" CHECK("holdings"."price" >= 0),
	CONSTRAINT "holdings_amount_check" CHECK("holdings"."amount" >= 0)
);
--> statement-breakpoint
-- Edited by hand: SQLite adds a not-null column only with a default, and
-- `cash` has none, so the table is rebuilt with every row's cash its balance,
-- true of every account until a trade's holdings are valued. Nothing
-- references `balances`, so no foreign key has to be switched off.
CREATE TABLE `__new_balances` (
	`account_id` text NOT NULL,
	`date` text NOT NULL,
	`balance` integer NOT NULL,
	`cash` integer NOT NULL,
	`currency` text NOT NULL,
	PRIMARY KEY(`account_id`, `date`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_balances`("account_id", "date", "balance", "cash", "currency") SELECT "account_id", "date", "balance", "balance", "currency" FROM `balances`;--> statement-breakpoint
DROP TABLE `balances`;--> statement-breakpoint
ALTER TABLE `__new_balances` RENAME TO `balances`;