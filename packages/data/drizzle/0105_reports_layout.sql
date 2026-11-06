-- Sure's reports keys of `users.preferences` (Story 34.7): null is its
-- default order, so no existing user needs a value.
ALTER TABLE `users` ADD `reports_layout` text;
