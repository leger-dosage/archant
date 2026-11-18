-- Adding the check with the column avoids rebuilding entries, which owns
-- the foreign keys that hold transaction history together.
ALTER TABLE `entries` ADD `reconciliation_status` text DEFAULT 'unreconciled' NOT NULL
	CONSTRAINT "entries_reconciliation_status_check"
	CHECK (`reconciliation_status` IN ('unreconciled', 'cleared', 'reconciled'));
