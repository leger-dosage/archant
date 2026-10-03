-- `ON DELETE restrict` added by hand: drizzle-kit leaves it out of an added column.
ALTER TABLE `entries` ADD `parent_entry_id` text REFERENCES entries(id) ON DELETE restrict;--> statement-breakpoint
CREATE INDEX `entries_parent_entry` ON `entries` (`parent_entry_id`) WHERE "entries"."parent_entry_id" is not null;
