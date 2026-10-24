import type { RuleInput } from "../rules.ts";

import { z } from "zod";

import { ACTIVITY_LABELS } from "@archant/data/activity-labels";
import { RULE_OPERATORS_BY_TYPE } from "@archant/data/rules";

import { MAX_RULE_CONDITIONS, RULE_TYPE_VALUES } from "../rules.ts";
import { MAX_TAGS_PER_TRANSACTION } from "../transactions.ts";
import { clampedPageFields } from "./fields.ts";

/** `get_rule_runs`: a page of past applications, paged as Sure's `get_categories`. */
export const ruleRunsInput = z.strictObject(clampedPageFields);

const operatorsOf = <Type extends keyof typeof RULE_OPERATORS_BY_TYPE>(type: Type, what: string) =>
	z.enum(RULE_OPERATORS_BY_TYPE[type]).describe(what);

/** `is_null` and `is_not_null` read no value: it is omitted or `null`. */
const optionalValue = (what: string) => z.string().nullable().optional().describe(what);

const TEXT_OPERATORS =
	'"like": contains the value, case aside, accents counting; "not_like": does not contain it, or empty; "=": the whole text, case included; "!=": anything else, or empty; "is_null": empty and "is_not_null": not empty, without a value.';

/** Sure's select operators: `!=` takes a row without one too. */
const selectOperators = (what: string, none: string) =>
	`"=": ${what}; "!=": anything else, ${none} included; "is_null": ${none} and "is_not_null": any, without a value.`;

/**
 * One leaf condition per type, each with its own operators, so a refused
 * operator names its type's: the shape of `RULE_OPERATORS_BY_TYPE`.
 */
const leafConditions = [
	z.strictObject({
		condition_type: z.literal("transaction_name"),
		operator: operatorsOf("transaction_name", TEXT_OPERATORS),
		value: optionalValue("Text compared with the label as the bank wrote it."),
	}),
	z.strictObject({
		condition_type: z.literal("transaction_amount"),
		operator: operatorsOf(
			"transaction_amount",
			"Compares the transaction's absolute amount with the value.",
		),
		value: z
			.string()
			.describe(
				'A decimal string such as "12.50", without a sign and with at most eight decimals, in major units of whatever currency each transaction is in.',
			),
	}),
	z.strictObject({
		condition_type: z.literal("transaction_account"),
		operator: operatorsOf(
			"transaction_account",
			selectOperators("the transaction is in this account", "no account, which never happens,"),
		),
		value: optionalValue("An account id from get_accounts."),
	}),
	z.strictObject({
		condition_type: z.literal("transaction_merchant"),
		operator: operatorsOf("transaction_merchant", selectOperators("this merchant", "no merchant")),
		value: optionalValue("A merchant id from get_merchants or create_merchant."),
	}),
	z.strictObject({
		condition_type: z.literal("transaction_category"),
		operator: operatorsOf(
			"transaction_category",
			selectOperators("exactly this category, never one of its children", "uncategorised"),
		),
		value: optionalValue("A category id from get_categories or create_category."),
	}),
	z.strictObject({
		condition_type: z.literal("transaction_tag"),
		operator: operatorsOf(
			"transaction_tag",
			'"=": carries this tag among others; "is_null": carries no tag, without a value.',
		),
		value: optionalValue("A tag id from get_tags or create_tag."),
	}),
	z.strictObject({
		condition_type: z.literal("transaction_details"),
		operator: operatorsOf(
			"transaction_details",
			'"like": a value the bank sent beside the transaction, such as its merchant category code or exchange rate, contains the text, case aside; "=": the same, case included; "is_null": the bank sent no details, without a value. Keys are never searched.',
		),
		value: optionalValue("Text searched in the details' values."),
	}),
	z.strictObject({
		condition_type: z.literal("transaction_notes"),
		operator: operatorsOf("transaction_notes", TEXT_OPERATORS),
		value: optionalValue("Text compared with the notes."),
	}),
	z.strictObject({
		condition_type: z.literal("transaction_type"),
		operator: operatorsOf("transaction_type", '"=": the transaction is of this type.'),
		value: z
			.enum(RULE_TYPE_VALUES)
			.describe("income, expense or transfer, as the transaction list's type filter."),
	}),
] as const;

const leafCondition = z.discriminatedUnion("condition_type", leafConditions);

const condition = z.discriminatedUnion("condition_type", [
	...leafConditions,
	z.strictObject({
		condition_type: z.literal("compound"),
		operator: operatorsOf(
			"compound",
			'"and": every condition of the group holds; "or": any of them. An empty group matches every transaction.',
		),
		conditions: z
			.array(leafCondition)
			.max(MAX_RULE_CONDITIONS)
			.describe("Conditions of any type but a group: groups nest one level deep."),
	}),
]);

const action = z.discriminatedUnion("action_type", [
	z.strictObject({
		action_type: z.literal("set_transaction_category"),
		value: z.string().describe("A category id from get_categories or create_category."),
	}),
	z.strictObject({
		action_type: z.literal("set_transaction_merchant"),
		value: z.string().describe("A merchant id from get_merchants or create_merchant."),
	}),
	z.strictObject({
		action_type: z.literal("set_transaction_tags"),
		value: z
			.string()
			.describe(
				`Tag ids from get_tags or create_tag, separated by commas such as "id1,id2", up to ${MAX_TAGS_PER_TRANSACTION}, each added to the tags the transaction keeps.`,
			),
	}),
	z.strictObject({
		action_type: z.literal("set_transaction_name"),
		value: z.string().describe("The new label, replacing the whole label."),
	}),
	z.strictObject({
		action_type: z.literal("replace_in_transaction_name"),
		value: z
			.string()
			.describe(
				"An RE2 regular expression, case ignored: no back reference, no lookaround. Every match in the label is replaced.",
			),
		replacement: z
			.string()
			.describe(
				"The text put in place of each match, literally: $1 means nothing. Empty removes it.",
			),
	}),
	z.strictObject({
		action_type: z.literal("set_investment_activity_label"),
		value: z
			.enum(ACTIVITY_LABELS)
			.describe("The investment activity label written on the transaction, as Sure names it."),
	}),
	z.strictObject({
		action_type: z.literal("exclude_transaction"),
		value: z.null().optional().describe("None: the transaction is left out of reports."),
	}),
	z.strictObject({
		action_type: z.literal("set_as_transfer_or_payment"),
		value: z
			.string()
			.describe(
				"The account id from get_accounts where the other side of the transfer is expected; Archant pairs the two when it finds it.",
			),
	}),
]);

/**
 * A rule as the interface's form sends it, its condition and action types
 * closed: the shape `createRule` and `updateRule` take, checked by them again.
 */
const ruleFields = {
	name: z
		.string()
		.nullable()
		.optional()
		.describe("A short name; without one, the list shows the conditions."),
	effective_date: z
		.string()
		.nullable()
		.optional()
		.describe(
			"YYYY-MM-DD: the rule reaches transactions dated on or after it; null for every date.",
		),
	conditions: z
		.array(condition)
		.max(MAX_RULE_CONDITIONS)
		.describe("Every one must hold. An empty list matches every transaction."),
	actions: z
		.array(action)
		.min(1)
		.describe("One at least, each type once, applied in order to every matching transaction."),
};

type ToolRule = z.output<z.ZodObject<typeof ruleFields>>;

type ToolCondition = ToolRule["conditions"][number];

/** A condition as the rule form sends it. */
function conditionInputOf(drafted: ToolCondition): RuleInput["conditions"][number] {
	if (drafted.condition_type === "compound") {
		return {
			conditionType: drafted.condition_type,
			operator: drafted.operator,
			conditions: drafted.conditions.map(conditionInputOf),
		};
	}

	return {
		conditionType: drafted.condition_type,
		operator: drafted.operator,
		value: drafted.value,
	};
}

/** The rule form's shape, which `createRule` and `updateRule` parse, from the tool's names. */
function ruleInputOf({ name, effective_date, conditions, actions }: ToolRule): RuleInput {
	return {
		name,
		effectiveDate: effective_date,
		conditions: conditions.map(conditionInputOf),
		actions: actions.map(({ action_type, ...rest }) => ({ actionType: action_type, ...rest })),
	};
}

export const ruleToolInput = z.strictObject(ruleFields).transform(ruleInputOf);

const ruleId = z.string().min(1).describe("A rule id from get_rules or create_rule.");

export const updateRuleInput = z
	.strictObject({ rule_id: ruleId, ...ruleFields })
	.transform(({ rule_id, ...rule }) => ({ ruleId: rule_id, rule: ruleInputOf(rule) }));

export const ruleIdInput = z.strictObject({ rule_id: ruleId });

export const setRuleEnabledInput = z.strictObject({
	rule_id: ruleId,
	enabled: z.boolean().describe("false stops the rule; what it wrote stays."),
});

/** `preview_rule`: a saved rule, a draft, or every enabled rule when neither is given. */
export const previewRuleInput = z
	.strictObject({
		rule_id: ruleId.optional(),
		rule: ruleToolInput.optional().describe("A draft in create_rule's shape, not saved."),
	})
	.superRefine((value, context) => {
		if (value.rule_id !== undefined && value.rule !== undefined) {
			context.addIssue({ code: "custom", path: ["rule"], message: "rule_id_or_rule" });
		}
	});

export const applyRulesInput = z.strictObject({
	rule_id: ruleId
		.optional()
		.describe("The rule to apply, enabled or not; absent for every enabled rule."),
	expected_changed: z
		.number()
		.int()
		.min(0)
		.describe(
			"The changed count preview_rule gave for the same rule_id: nothing is written if it differs now.",
		),
});
