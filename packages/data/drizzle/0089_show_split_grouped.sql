-- Sure's `show_split_grouped` preference (Story 31.3): on for every existing
-- user, as Sure reads an absent preference as on.
ALTER TABLE `users` ADD `show_split_grouped` integer DEFAULT true NOT NULL;
