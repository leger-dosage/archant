-- The country is saved with the credentials now (Story 29.1), and stored
-- credentials without one count as none. Credentials saved before it take
-- the country of the latest active connection, the one the household last
-- chose, before any abandoned attempt, else France, which the picker used
-- to open on.
INSERT INTO `settings` (`key`, `value`, `updated_at`)
SELECT
	'enable_banking_country',
	coalesce(
		(
			SELECT `country` FROM `bank_connections`
			WHERE `country` IN ('FR', 'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'DE', 'GR', 'HU', 'IS', 'IE', 'IT', 'LV', 'LI', 'LT', 'LU', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'GB')
			ORDER BY `status` = 'active' DESC, `created_at` DESC, `id` DESC
			LIMIT 1
		),
		'FR'
	),
	cast(unixepoch('subsecond') * 1000 as integer)
WHERE EXISTS (SELECT 1 FROM `settings` WHERE `key` = 'enable_banking_application_id')
ON CONFLICT (`key`) DO NOTHING;
