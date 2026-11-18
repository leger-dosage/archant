ALTER TABLE `goals` ADD `progress_basis` text DEFAULT 'balance' NOT NULL
CONSTRAINT `goals_progress_basis_check` CHECK (`progress_basis` IN ('balance', 'contributions'));
