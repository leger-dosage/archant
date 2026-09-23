import type { RuleActionType, RuleConditionType, RuleOperator } from "../rules.ts";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import {
	RULE_ACTION_TYPES,
	RULE_CONDITION_TYPES,
	RULE_OPERATORS,
	RULE_OPERATORS_BY_TYPE,
} from "../rules.ts";
import { inList } from "./check.ts";

/**
 * Sure's `Rule`. Enabled rules run on every new transaction in creation
 * order; a rule reaches transactions dated on or after `effective_date`, every
 * date when it is null.
 */
export const rules = sqliteTable("rules", {
	id: text("id").primaryKey(),
	// Null shows the summary built from the first condition and the action.
	name: text("name"),
	enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
	effectiveDate: text("effective_date"),
	createdAt: integer("created_at").notNull(),
	updatedAt: integer("updated_at").notNull(),
});

/**
 * Sure's `Rule::Condition`. A `compound` condition is a group whose
 * sub-conditions point at it through `parent_id`, one level deep. `value` is
 * text as in Sure: the label, the amount in minor units, or an account id,
 * with no foreign key, so a deleted account leaves the rule inert rather than
 * blocking the delete.
 */
export const ruleConditions = sqliteTable(
	"rule_conditions",
	{
		id: text("id").primaryKey(),
		// Set on sub-conditions too, so deleting a rule cascades to all of them
		// in one step rather than through the group.
		ruleId: text("rule_id")
			.notNull()
			.references(() => rules.id, { onDelete: "cascade" }),
		parentId: text("parent_id").references((): AnySQLiteColumn => ruleConditions.id, {
			onDelete: "cascade",
		}),
		// The form's order; Sure sorts by `created_at`, which a replace would reset.
		position: integer("position").notNull(),
		conditionType: text("condition_type").$type<RuleConditionType>().notNull(),
		operator: text("operator").$type<RuleOperator>().notNull(),
		value: text("value"),
	},
	(table) => [
		index("rule_conditions_rule").on(table.ruleId),
		index("rule_conditions_parent").on(table.parentId),
		check(
			"rule_conditions_type_check",
			sql`${table.conditionType} in ${inList(RULE_CONDITION_TYPES)}`,
		),
		check("rule_conditions_operator_check", sql`${table.operator} in ${inList(RULE_OPERATORS)}`),
		check(
			"rule_conditions_operator_of_type_check",
			sql.join(
				RULE_CONDITION_TYPES.map(
					(type) =>
						sql`(${table.conditionType} = ${sql.raw(`'${type}'`)} and ${table.operator} in ${inList(RULE_OPERATORS_BY_TYPE[type])})`,
				),
				sql` or `,
			),
		),
	],
);

/**
 * Sure's `Rule::Action`. `value` is a category id without a foreign key, for
 * the same reason as a condition's account: a deleted category makes the
 * action write nothing.
 */
export const ruleActions = sqliteTable(
	"rule_actions",
	{
		id: text("id").primaryKey(),
		ruleId: text("rule_id")
			.notNull()
			.references(() => rules.id, { onDelete: "cascade" }),
		position: integer("position").notNull(),
		actionType: text("action_type").$type<RuleActionType>().notNull(),
		value: text("value").notNull(),
	},
	(table) => [
		index("rule_actions_rule").on(table.ruleId),
		check("rule_actions_type_check", sql`${table.actionType} in ${inList(RULE_ACTION_TYPES)}`),
	],
);
