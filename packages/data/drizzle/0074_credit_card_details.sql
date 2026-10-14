ALTER TABLE `bank_accounts` ADD `credit_limit` integer;--> statement-breakpoint
ALTER TABLE `bank_accounts` ADD `treat_balance_as_available_credit` integer DEFAULT false NOT NULL;