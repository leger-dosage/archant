PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_goals` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`target_amount` integer NOT NULL,
	`currency` text NOT NULL,
	`target_date` text,
	`color` text NOT NULL,
	`icon` text NOT NULL,
	`notes` text,
	`state` text DEFAULT 'active' NOT NULL,
	`kind` text DEFAULT 'one_off' NOT NULL,
	`completed_amount` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "goals_target_amount_check" CHECK("__new_goals"."target_amount" > 0),
	CONSTRAINT "goals_state_check" CHECK("__new_goals"."state" in ('active', 'paused', 'completed', 'archived')),
	CONSTRAINT "goals_kind_check" CHECK("__new_goals"."kind" in ('one_off', 'maintained')),
	CONSTRAINT "goals_completed_check" CHECK(("__new_goals"."completed_amount" is null) = ("__new_goals"."completed_at" is null))
);
--> statement-breakpoint
-- Edited by hand: drizzle-kit read `completed_amount` and `completed_at` from the
-- old table, which has neither, and SQLite would have stored their names as text.
-- No goal could be completed before this story.
INSERT INTO `__new_goals`("id", "name", "target_amount", "currency", "target_date", "color", "icon", "notes", "state", "kind", "completed_amount", "completed_at", "created_at", "updated_at") SELECT "id", "name", "target_amount", "currency", "target_date", "color", "icon", "notes", "state", "kind", null, null, "created_at", "updated_at" FROM `goals`;--> statement-breakpoint
DROP TABLE `goals`;--> statement-breakpoint
ALTER TABLE `__new_goals` RENAME TO `goals`;--> statement-breakpoint
PRAGMA foreign_keys=ON;