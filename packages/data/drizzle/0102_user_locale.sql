-- Sure's `users.locale` (Story 37.1): null follows the browser's language, so
-- every existing user keeps reading what their browser asks for. Written by
-- hand: Drizzle rebuilds `users` to add a check, and its copy selects `locale`
-- from the old table, which has none. SQLite accepts a check on an added column.
ALTER TABLE `users` ADD `locale` text CONSTRAINT "users_locale_check" CHECK(`locale` is null or `locale` in ('en', 'fr'));
