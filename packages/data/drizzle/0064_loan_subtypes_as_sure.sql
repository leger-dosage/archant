PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`subtype` text,
	`currency` text NOT NULL,
	`details` text,
	`active` integer DEFAULT true NOT NULL,
	`excluded_from_reports` integer DEFAULT false NOT NULL,
	`bank_account_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`bank_account_id`) REFERENCES `bank_accounts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "accounts_type_check" CHECK("__new_accounts"."type" in ('depository', 'credit_card', 'loan', 'investment', 'property', 'vehicle')),
	CONSTRAINT "accounts_subtype_check" CHECK(("__new_accounts"."type" = 'depository' and "__new_accounts"."subtype" is not null and "__new_accounts"."subtype" in ('checking', 'savings')) or ("__new_accounts"."type" = 'credit_card' and "__new_accounts"."subtype" is null) or ("__new_accounts"."type" = 'loan' and "__new_accounts"."subtype" is not null and "__new_accounts"."subtype" in ('mortgage', 'student', 'auto', 'home_equity', 'line_of_credit', 'business', 'other')) or ("__new_accounts"."type" = 'investment' and "__new_accounts"."subtype" is not null and "__new_accounts"."subtype" in ('pea', 'assurance_vie', 'brokerage', 'other')) or ("__new_accounts"."type" = 'property' and "__new_accounts"."subtype" is not null and "__new_accounts"."subtype" in ('single_family_home', 'apartment', 'second_home', 'investment_property', 'plot', 'commercial')) or ("__new_accounts"."type" = 'vehicle' and "__new_accounts"."subtype" is null))
);
--> statement-breakpoint
-- Edited by hand: Sure's `Loan::SUBTYPES` has no consumer loan, so one becomes
-- Sure's `other`, its catch-all, as the export already wrote it; the owner
-- picks one of Sure's subtypes again if another fits.
INSERT INTO `__new_accounts`("id", "name", "type", "subtype", "currency", "details", "active", "excluded_from_reports", "bank_account_id", "created_at", "updated_at") SELECT "id", "name", "type", CASE WHEN "type" = 'loan' AND "subtype" = 'consumer' THEN 'other' ELSE "subtype" END, "currency", "details", "active", "excluded_from_reports", "bank_account_id", "created_at", "updated_at" FROM `accounts`;--> statement-breakpoint
DROP TABLE `accounts`;--> statement-breakpoint
ALTER TABLE `__new_accounts` RENAME TO `accounts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_bank_account_unique` ON `accounts` (`bank_account_id`);