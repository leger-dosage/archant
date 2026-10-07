PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_goals` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`target_amount` integer NOT NULL,
	`currency` text NOT NULL,
	`target_date` text,
	`color` text NOT NULL,
	`icon` text,
	`notes` text,
	`state` text DEFAULT 'active' NOT NULL,
	`kind` text DEFAULT 'one_off' NOT NULL,
	`target_mode` text DEFAULT 'fixed' NOT NULL,
	`target_months` integer,
	`completed_amount` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "goals_target_amount_check" CHECK("__new_goals"."target_amount" > 0),
	CONSTRAINT "goals_state_check" CHECK("__new_goals"."state" in ('active', 'paused', 'completed', 'archived')),
	CONSTRAINT "goals_kind_check" CHECK("__new_goals"."kind" in ('one_off', 'maintained')),
	CONSTRAINT "goals_target_mode_check" CHECK("__new_goals"."target_mode" in ('fixed', 'months_of_expenses')),
	CONSTRAINT "goals_target_months_check" CHECK(("__new_goals"."target_mode" = 'months_of_expenses') = ("__new_goals"."target_months" is not null)),
	CONSTRAINT "goals_target_months_range_check" CHECK("__new_goals"."target_months" between 1 and 120),
	CONSTRAINT "goals_target_mode_kind_check" CHECK("__new_goals"."target_mode" = 'fixed' or "__new_goals"."kind" = 'maintained'),
	CONSTRAINT "goals_reserve_date_check" CHECK("__new_goals"."kind" = 'one_off' or "__new_goals"."target_date" is null),
	CONSTRAINT "goals_completed_check" CHECK(("__new_goals"."completed_amount" is null) = ("__new_goals"."completed_at" is null))
);
--> statement-breakpoint
INSERT INTO `__new_goals`("id", "name", "target_amount", "currency", "target_date", "color", "icon", "notes", "state", "kind", "target_mode", "target_months", "completed_amount", "completed_at", "created_at", "updated_at") SELECT "id", "name", "target_amount", "currency", "target_date", "color", "icon", "notes", "state", "kind", "target_mode", "target_months", "completed_amount", "completed_at", "created_at", "updated_at" FROM `goals`;--> statement-breakpoint
DROP TABLE `goals`;--> statement-breakpoint
ALTER TABLE `__new_goals` RENAME TO `goals`;--> statement-breakpoint
PRAGMA foreign_keys=ON;