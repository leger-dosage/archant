ALTER TABLE `merchants` ADD `color` text DEFAULT '#e99537' NOT NULL;--> statement-breakpoint
ALTER TABLE `merchants` ADD `website_url` text;--> statement-breakpoint
ALTER TABLE `tags` ADD `color` text DEFAULT '#e99537' NOT NULL;--> statement-breakpoint
-- The column default only lets SQLite add a NOT NULL column; the schema's
-- `$defaultFn` draws a new row's colour. Sure's migrations gave every
-- existing row `#e99537`; one orange for every merchant and tag would make
-- the colour mean nothing, so each existing row draws one of Sure's ten.
UPDATE `merchants` SET `color` = CASE (random() % 10 + 10) % 10
	WHEN 0 THEN '#e99537' WHEN 1 THEN '#4da568' WHEN 2 THEN '#6471eb' WHEN 3 THEN '#db5a54'
	WHEN 4 THEN '#df4e92' WHEN 5 THEN '#c44fe9' WHEN 6 THEN '#eb5429' WHEN 7 THEN '#61c9ea'
	WHEN 8 THEN '#805dee' ELSE '#6ad28a' END;--> statement-breakpoint
UPDATE `tags` SET `color` = CASE (random() % 10 + 10) % 10
	WHEN 0 THEN '#e99537' WHEN 1 THEN '#4da568' WHEN 2 THEN '#6471eb' WHEN 3 THEN '#db5a54'
	WHEN 4 THEN '#df4e92' WHEN 5 THEN '#c44fe9' WHEN 6 THEN '#eb5429' WHEN 7 THEN '#61c9ea'
	WHEN 8 THEN '#805dee' ELSE '#6ad28a' END;
