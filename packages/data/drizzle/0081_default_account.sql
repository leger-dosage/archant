-- drizzle-kit drops the `ON DELETE` of a column it adds with a reference;
-- written by hand so deleting an account clears it, as Sure's `on_delete: :nullify`.
ALTER TABLE `users` ADD `default_account_id` text REFERENCES accounts(id) ON DELETE set null;
