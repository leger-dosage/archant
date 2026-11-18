ALTER TABLE `rules` ADD `position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `rules` ADD `stop_processing` integer DEFAULT false NOT NULL;
--> statement-breakpoint
WITH ordered AS (
	SELECT id, row_number() OVER (ORDER BY created_at, id) - 1 AS position
	FROM rules
)
UPDATE rules SET position = ordered.position FROM ordered WHERE rules.id = ordered.id;
