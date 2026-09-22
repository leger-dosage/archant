ALTER TABLE `entries` ADD `import_id` text REFERENCES imports(id) ON UPDATE no action ON DELETE restrict;--> statement-breakpoint
CREATE INDEX `entries_import` ON `entries` (`import_id`);