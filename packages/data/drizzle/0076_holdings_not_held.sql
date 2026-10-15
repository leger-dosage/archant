PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_holdings` (
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
	CONSTRAINT "holdings_price_check" CHECK("__new_holdings"."price" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_holdings`("account_id", "security_id", "date", "quantity", "price", "amount", "cost_basis") SELECT "account_id", "security_id", "date", "quantity", "price", "amount", "cost_basis" FROM `holdings`;--> statement-breakpoint
DROP TABLE `holdings`;--> statement-breakpoint
ALTER TABLE `__new_holdings` RENAME TO `holdings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `holdings_not_held` ON `holdings` (`account_id`,`security_id`,`date`,`quantity`) WHERE quantity <= 0;