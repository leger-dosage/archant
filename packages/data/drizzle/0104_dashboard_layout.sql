-- Sure's dashboard keys of `users.preferences` (Story 34.6): null is its
-- default layout, so no existing user needs a value.
ALTER TABLE `users` ADD `dashboard_layout` text;
