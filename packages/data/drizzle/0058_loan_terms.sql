-- Edited by hand: no column changes, so drizzle-kit has nothing to generate.
-- A loan's details move to Sure's terms (Story 24.1). The rate goes from basis
-- points to millionths (AD-25): 3,45 % was 345 and is 34500. Every new key
-- starts unknown. `endDate` stays until the loan's details are next saved,
-- when the edit dialog proposes the months up to it as the term.
UPDATE `accounts` SET `details` = json_set(
	`details`,
	'$.interestRate', json_extract(`details`, '$.interestRate') * 100,
	'$.downPayment', NULL,
	'$.startDate', NULL,
	'$.termMonths', NULL,
	'$.rateType', NULL,
	'$.insuranceRate', NULL,
	'$.insuranceRateType', NULL,
	'$.rateChanges', json('[]')
) WHERE `type` = 'loan' AND `details` IS NOT NULL;
