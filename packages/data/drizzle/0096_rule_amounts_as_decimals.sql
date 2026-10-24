-- An amount condition held minor units of the reporting currency; it is now
-- Sure's decimal text in major units, compared with a line in any currency.
-- The reporting currency has only ever been EUR (`getReportingCurrency`), so
-- each value takes two decimals: 5000 becomes 50.00 and matches what it did.
UPDATE `rule_conditions`
SET `value` = printf('%d.%02d', CAST(`value` AS INTEGER) / 100, CAST(`value` AS INTEGER) % 100)
WHERE `condition_type` = 'transaction_amount' AND `value` IS NOT NULL;--> statement-breakpoint
-- A run keeps the rule as it was, so its summary reads the same values; a
-- group nests one level deep.
UPDATE `rule_runs`
SET `rule` = json_set(`rule`, '$.conditions', (
	SELECT json_group_array(
		CASE
			WHEN json_extract(`top`.`value`, '$.conditionType') = 'transaction_amount'
				AND json_extract(`top`.`value`, '$.value') IS NOT NULL
			THEN json_set(`top`.`value`, '$.value', printf('%d.%02d',
				CAST(json_extract(`top`.`value`, '$.value') AS INTEGER) / 100,
				CAST(json_extract(`top`.`value`, '$.value') AS INTEGER) % 100))
			WHEN json_extract(`top`.`value`, '$.conditionType') = 'compound'
			THEN json_set(`top`.`value`, '$.conditions', (
				SELECT json_group_array(
					CASE
						WHEN json_extract(`child`.`value`, '$.conditionType') = 'transaction_amount'
							AND json_extract(`child`.`value`, '$.value') IS NOT NULL
						THEN json_set(`child`.`value`, '$.value', printf('%d.%02d',
							CAST(json_extract(`child`.`value`, '$.value') AS INTEGER) / 100,
							CAST(json_extract(`child`.`value`, '$.value') AS INTEGER) % 100))
						ELSE json(`child`.`value`)
					END
				)
				FROM json_each(`top`.`value`, '$.conditions') AS `child`
			))
			ELSE json(`top`.`value`)
		END
	)
	FROM json_each(`rule`, '$.conditions') AS `top`
))
WHERE `rule` LIKE '%transaction_amount%';
