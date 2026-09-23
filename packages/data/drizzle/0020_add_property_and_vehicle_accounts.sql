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
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "accounts_type_check" CHECK("__new_accounts"."type" in ('depository', 'credit_card', 'loan', 'investment', 'property', 'vehicle')),
	CONSTRAINT "accounts_subtype_check" CHECK(("__new_accounts"."type" = 'depository' and "__new_accounts"."subtype" is not null and "__new_accounts"."subtype" in ('checking', 'savings')) or ("__new_accounts"."type" = 'credit_card' and "__new_accounts"."subtype" is null) or ("__new_accounts"."type" = 'loan' and "__new_accounts"."subtype" is not null and "__new_accounts"."subtype" in ('mortgage', 'consumer', 'other')) or ("__new_accounts"."type" = 'investment' and "__new_accounts"."subtype" is not null and "__new_accounts"."subtype" in ('pea', 'assurance_vie', 'brokerage', 'other')) or ("__new_accounts"."type" = 'property' and "__new_accounts"."subtype" is not null and "__new_accounts"."subtype" in ('single_family_home', 'apartment', 'second_home', 'investment_property', 'plot', 'commercial')) or ("__new_accounts"."type" = 'vehicle' and "__new_accounts"."subtype" is null))
);
--> statement-breakpoint
INSERT INTO `__new_accounts`("id", "name", "type", "subtype", "currency", "details", "active", "excluded_from_reports", "created_at", "updated_at") SELECT "id", "name", "type", "subtype", "currency", "details", "active", "excluded_from_reports", "created_at", "updated_at" FROM `accounts`;--> statement-breakpoint
DROP TABLE `accounts`;--> statement-breakpoint
ALTER TABLE `__new_accounts` RENAME TO `accounts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;