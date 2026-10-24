-- Sure's `BackfillInvestmentContributionCategories`: a contribution's outflow
-- paired before Story 31.7 takes « Contributions aux investissements » when it
-- has no category and the household still has that category; a household that
-- deleted it gets it back with its next contribution, as Sure.
UPDATE `transactions`
SET
	`category_id` = (
		SELECT `id` FROM `categories` WHERE lower(`name`) = 'contributions aux investissements'
	),
	`category_origin` = 'rule'
WHERE `category_id` IS NULL
	AND `entry_id` IN (
		SELECT `outflow_transaction_id` FROM `transfers` WHERE `kind` = 'investment_contribution'
	)
	AND EXISTS (
		SELECT 1 FROM `categories` WHERE lower(`name`) = 'contributions aux investissements'
	);
