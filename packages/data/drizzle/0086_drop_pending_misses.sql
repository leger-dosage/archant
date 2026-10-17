-- No sync deletes a pending entry the bank stops listing any more, as Sure's
-- adapter never does (Story 29.6): the misses counted towards it go.
ALTER TABLE `transactions` DROP COLUMN `pending_missed_syncs`;--> statement-breakpoint
ALTER TABLE `transactions` DROP COLUMN `pending_missed_on`;
