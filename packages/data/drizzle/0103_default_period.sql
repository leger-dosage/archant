-- Sure's `users.default_period` (Story 34.3): every existing user reads Sure's
-- default, the last 30 days. Written by hand: Drizzle rebuilds `users` to add
-- a check, and its copy selects `default_period` from the old table, which has
-- none. SQLite accepts a check on an added column.
ALTER TABLE `users` ADD `default_period` text DEFAULT 'last_30_days' NOT NULL CONSTRAINT "users_default_period_check" CHECK(`default_period` in ('last_day', 'current_week', 'last_7_days', 'current_month', 'last_month', 'last_30_days', 'last_90_days', 'current_year', 'last_365_days', 'last_5_years', 'last_10_years', 'all_time'));
