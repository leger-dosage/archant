-- A tag action now holds several tag ids, comma-separated as Sure's
-- `Rule::Action#value=` stores them, and a rule holds one action of each type,
-- as Sure's `no_duplicate_actions`. The API has always refused a second tag
-- action, so only a row written by hand can hold one: the rule keeps its
-- first tag action, holding every tag of them all once, in their order.
UPDATE `rule_actions`
SET `value` = (
	WITH RECURSIVE `part` (`position`, `rest`, `id`, `n`) AS (
		SELECT `other`.`position`, `other`.`value` || ',', NULL, 0
		FROM `rule_actions` AS `other`
		WHERE `other`.`rule_id` = `rule_actions`.`rule_id`
			AND `other`.`action_type` = 'set_transaction_tags'
		UNION ALL
		SELECT
			`position`,
			substr(`rest`, instr(`rest`, ',') + 1),
			trim(substr(`rest`, 1, instr(`rest`, ',') - 1)),
			`n` + 1
		FROM `part`
		WHERE `rest` <> ''
	)
	-- An ordered `group_concat` (SQLite 3.44) keeps each tag's first place.
	SELECT group_concat(`id`, ',' ORDER BY `rank`) FROM (
		SELECT `id`, min(`position` * 1000000 + `n`) AS `rank` FROM `part`
		WHERE `id` <> ''
		GROUP BY `id`
	)
)
WHERE `action_type` = 'set_transaction_tags'
	AND `position` = (
		SELECT min(`other`.`position`) FROM `rule_actions` AS `other`
		WHERE `other`.`rule_id` = `rule_actions`.`rule_id`
			AND `other`.`action_type` = 'set_transaction_tags'
	)
	AND (
		SELECT count(*) FROM `rule_actions` AS `other`
		WHERE `other`.`rule_id` = `rule_actions`.`rule_id`
			AND `other`.`action_type` = 'set_transaction_tags'
	) > 1;--> statement-breakpoint
DELETE FROM `rule_actions`
WHERE `action_type` = 'set_transaction_tags'
	AND `position` > (
		SELECT min(`other`.`position`) FROM `rule_actions` AS `other`
		WHERE `other`.`rule_id` = `rule_actions`.`rule_id`
			AND `other`.`action_type` = 'set_transaction_tags'
	);
