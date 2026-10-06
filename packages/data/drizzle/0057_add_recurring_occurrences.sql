CREATE TABLE `recurring_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`recurring_occurrence_id` text NOT NULL,
	`entry_id` text,
	`allocated_amount` integer NOT NULL,
	`state` text NOT NULL,
	`source` text NOT NULL,
	`match_confidence` integer,
	`match_signals` text DEFAULT '{}' NOT NULL,
	`paid_on` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`recurring_occurrence_id`) REFERENCES `recurring_occurrences`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "recurring_allocations_amount_check" CHECK("recurring_allocations"."allocated_amount" > 0),
	CONSTRAINT "recurring_allocations_state_check" CHECK("recurring_allocations"."state" in ('suggested', 'confirmed')),
	CONSTRAINT "recurring_allocations_source_check" CHECK("recurring_allocations"."source" in ('auto_matched', 'user_confirmed', 'user_created'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_allocations_entry_once` ON `recurring_allocations` (`recurring_occurrence_id`,`entry_id`) WHERE "recurring_allocations"."entry_id" is not null;--> statement-breakpoint
CREATE INDEX `recurring_allocations_entry` ON `recurring_allocations` (`entry_id`);--> statement-breakpoint
CREATE TABLE `recurring_match_rejections` (
	`id` text PRIMARY KEY NOT NULL,
	`recurring_transaction_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`recurring_transaction_id`) REFERENCES `recurring_transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_match_rejections_pair_unique` ON `recurring_match_rejections` (`recurring_transaction_id`,`entry_id`);--> statement-breakpoint
CREATE INDEX `recurring_match_rejections_entry` ON `recurring_match_rejections` (`entry_id`);--> statement-breakpoint
CREATE TABLE `recurring_occurrences` (
	`id` text PRIMARY KEY NOT NULL,
	`recurring_transaction_id` text NOT NULL,
	`original_due_on` text NOT NULL,
	`due_on` text NOT NULL,
	`currency` text NOT NULL,
	`expected_amount` integer,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`snoozed_until` text,
	`closed_at` integer,
	`closed_source` text,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`recurring_transaction_id`) REFERENCES `recurring_transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "recurring_occurrences_status_check" CHECK("recurring_occurrences"."status" in ('scheduled', 'paid', 'skipped', 'missed')),
	CONSTRAINT "recurring_occurrences_closed_source_check" CHECK("recurring_occurrences"."closed_source" is null or "recurring_occurrences"."closed_source" in ('auto', 'user')),
	CONSTRAINT "recurring_occurrences_closed_state_check" CHECK(("recurring_occurrences"."status" = 'scheduled') = ("recurring_occurrences"."closed_at" is null)),
	CONSTRAINT "recurring_occurrences_expected_amount_check" CHECK("recurring_occurrences"."expected_amount" is null or "recurring_occurrences"."expected_amount" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_occurrences_identity_unique` ON `recurring_occurrences` (`recurring_transaction_id`,`original_due_on`);--> statement-breakpoint
CREATE INDEX `recurring_occurrences_status_due` ON `recurring_occurrences` (`status`,`due_on`);--> statement-breakpoint
CREATE TABLE `recurring_price_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`recurring_transaction_id` text NOT NULL,
	`effective_on` text NOT NULL,
	`previous_amount` integer NOT NULL,
	`new_amount` integer NOT NULL,
	`currency` text NOT NULL,
	`entry_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`recurring_transaction_id`) REFERENCES `recurring_transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "recurring_price_changes_amounts_check" CHECK("recurring_price_changes"."previous_amount" >= 0 and "recurring_price_changes"."new_amount" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_price_changes_identity_unique` ON `recurring_price_changes` (`recurring_transaction_id`,`effective_on`);--> statement-breakpoint
CREATE INDEX `recurring_price_changes_entry` ON `recurring_price_changes` (`entry_id`);--> statement-breakpoint
ALTER TABLE `recurring_transactions` ADD `name_aliases` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `recurring_transactions` ADD `learned_tolerance` integer;