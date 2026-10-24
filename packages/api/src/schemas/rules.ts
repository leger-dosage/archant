import { z } from "zod";

import { isActivityLabel } from "@archant/data/activity-labels";
import { parseUnsignedDecimal, toPlainDecimal } from "@archant/data/money";
import type {
	RuleActionType,
	RuleConditionType,
	RuleOperator,
	RuleOperatorOf,
} from "@archant/data/rules";
import {
	RULE_ACTION_TYPES,
	RULE_CONDITION_TYPES,
	RULE_NAME_MAX_LENGTH,
	RULE_OPERATORS,
	RULE_VALUE_MAX_LENGTH,
	isRuleOperatorOf,
	isValuelessOperator,
	isValuelessAction,
	tagIdsOf,
} from "@archant/data/rules";

import { DIRECTIONS } from "../domain/cash-flow.ts";
import { compileLabelPattern } from "../domain/rules/label-pattern.ts";
import { LABEL_MAX_LENGTH, MAX_TAGS_PER_TRANSACTION } from "./transactions.ts";

/**
 * The decimals an amount condition may carry: twice the four of ISO 4217's
 * finest currency. Sure sets no limit; the summary's `Intl.NumberFormat`
 * refuses past 100.
 */
const AMOUNT_MAX_DECIMALS = 8;

/** Past this a rule is no longer read at a glance; Sure sets no limit. */
export const MAX_RULE_CONDITIONS = 50;

// What the route checks: the body's shape, every value as text, so the typed
// client knows it. The service parses it afterwards with `ruleSchema`.
const conditionBody = z.object({
	conditionType: z.string(),
	operator: z.string(),
	value: z.string().nullable().optional(),
});

export const ruleBodySchema = z.object({
	name: z.string().nullable().optional(),
	effectiveDate: z.string().nullable().optional(),
	conditions: z.array(conditionBody.extend({ conditions: z.array(conditionBody).optional() })),
	actions: z.array(
		z.object({
			actionType: z.string(),
			value: z.string().nullable().optional(),
			replacement: z.string().nullable().optional(),
		}),
	),
});

export const ruleEnabledSchema = z.object({ enabled: z.boolean() });

export type RuleInput = z.input<typeof ruleBodySchema>;
export type RuleEnabledInput = z.input<typeof ruleEnabledSchema>;

const leafFields = {
	conditionType: z.enum(RULE_CONDITION_TYPES),
	operator: z.enum(RULE_OPERATORS),
	value: z.string().nullable().optional(),
};

const fields = {
	// A blank name is no name: the list shows the summary instead.
	name: z
		.string()
		.trim()
		.max(RULE_NAME_MAX_LENGTH)
		.nullable()
		.optional()
		.transform((value) => (value === undefined || value === "" ? null : value)),
	effectiveDate: z.iso
		.date()
		.nullable()
		.optional()
		.transform((value) => value ?? null),
	conditions: z
		.array(
			z.object({
				...leafFields,
				conditions: z.array(z.object(leafFields)).max(MAX_RULE_CONDITIONS).optional(),
			}),
		)
		.max(MAX_RULE_CONDITIONS),
	actions: z.array(
		z.object({
			actionType: z.enum(RULE_ACTION_TYPES),
			value: z.string().nullable().optional(),
			replacement: z.string().nullable().optional(),
		}),
	),
};

type Leaf = {
	conditionType: RuleConditionType;
	operator: RuleOperator;
	value?: string | null | undefined;
};

function issue(context: z.core.$RefinementCtx, path: (string | number)[], code: string) {
	context.addIssue({ code: "custom", path, message: code });
}

/** The values a type condition takes: the list's directions. */
export const RULE_TYPE_VALUES = DIRECTIONS;

const isDirection = (value: string) => RULE_TYPE_VALUES.some((known) => known === value);

/** A leaf condition's operator and value, reported under `path`. A valueless operator reads none. */
function checkLeaf(leaf: Leaf, path: (string | number)[], context: z.core.$RefinementCtx) {
	if (!isRuleOperatorOf(leaf.conditionType, leaf.operator)) {
		issue(context, [...path, "operator"], "invalid_value");
	}

	if (isValuelessOperator(leaf.operator)) {
		return;
	}

	const value = leaf.value?.trim() ?? "";

	if (value === "") {
		issue(context, [...path, "value"], "too_small");

		return;
	}

	const text =
		leaf.conditionType === "transaction_name" ||
		leaf.conditionType === "transaction_notes" ||
		leaf.conditionType === "transaction_details";

	if (text && value.length > RULE_VALUE_MAX_LENGTH) {
		issue(context, [...path, "value"], "too_big");
	}

	if (leaf.conditionType === "transaction_type" && !isDirection(value)) {
		issue(context, [...path, "value"], "invalid_value");
	}

	if (leaf.conditionType === "transaction_amount") {
		const amount = parseUnsignedDecimal(value);

		// Compared with the absolute amount, a sign would never match; past
		// `AMOUNT_MAX_DECIMALS` no currency has a meaning for the digits.
		if (
			value.length > RULE_VALUE_MAX_LENGTH ||
			amount === null ||
			amount.exponent > AMOUNT_MAX_DECIMALS
		) {
			issue(context, [...path, "value"], "invalid_amount");
		}
	}
}

/**
 * A replacement in the label: its pattern, which RE2 must read, and its
 * replacement, which may be empty. Neither is trimmed.
 */
function checkReplacement(
	action: { value?: string | null | undefined; replacement?: string | null | undefined },
	path: (string | number)[],
	context: z.core.$RefinementCtx,
) {
	const pattern = action.value ?? "";

	if (pattern === "") {
		issue(context, [...path, "value"], "too_small");
	} else if (pattern.length > RULE_VALUE_MAX_LENGTH) {
		issue(context, [...path, "value"], "too_big");
	} else if (compileLabelPattern(pattern) === null) {
		issue(context, [...path, "value"], "invalid_pattern");
	}

	if ((action.replacement ?? "").length > LABEL_MAX_LENGTH) {
		issue(context, [...path, "replacement"], "too_big");
	}
}

/**
 * A tag action's ids, comma-separated as Sure stores them: one at least, and
 * no more than a transaction holds, since the rest could never be added.
 */
function checkTags(value: string, path: (string | number)[], context: z.core.$RefinementCtx) {
	const count = tagIdsOf(value).length;

	if (count === 0) {
		issue(context, path, "too_small");
	} else if (count > MAX_TAGS_PER_TRANSACTION) {
		issue(context, path, "too_big");
	}
}

/**
 * An action's stored value: null for an exclusion, a tag action's ids without
 * blanks or repeats, the trimmed text otherwise.
 */
function storedActionValue(actionType: RuleActionType, value: string | null | undefined) {
	if (isValuelessAction(actionType)) {
		return null;
	}

	return actionType === "set_transaction_tags"
		? tagIdsOf(value ?? "").join(",")
		: (value?.trim() ?? "");
}

/**
 * One stored value: the trimmed text, the amount as Sure's decimal text in
 * major units with a dot, null for a valueless operator.
 */
function storedValue(leaf: Leaf): string | null {
	if (isValuelessOperator(leaf.operator)) {
		return null;
	}

	const value = leaf.value?.trim() ?? "";
	const amount = leaf.conditionType === "transaction_amount" ? parseUnsignedDecimal(value) : null;

	return amount === null ? value : toPlainDecimal(amount);
}

export type RuleLeafRequest = {
	conditionType: Exclude<RuleConditionType, "compound">;
	operator: RuleOperator;
	/** `null` for a valueless operator. */
	value: string | null;
};

export type RuleGroupRequest = {
	conditionType: "compound";
	operator: RuleOperatorOf<"compound">;
	conditions: RuleLeafRequest[];
};

export type RuleConditionRequest = RuleLeafRequest | RuleGroupRequest;

export type RuleRequest = {
	name: string | null;
	effectiveDate: string | null;
	conditions: RuleConditionRequest[];
	/**
	 * `value` is `null` for an exclusion, and the pattern for a replacement in
	 * the label, which alone has a `replacement`.
	 */
	actions: { actionType: RuleActionType; value: string | null; replacement: string | null }[];
};

/**
 * The full check of a rule, shared with the interface's form resolver so the
 * form reports the API's field codes. The amount belongs to no currency, as
 * in Sure: it is matched against a line in any. Groups nest one
 * level deep, a rule needs one action at least, and no action type twice, as
 * in Sure. An exclusion takes no value; every other action needs one, a
 * rename its new label, a tag action its tag ids comma-separated, as Sure's
 * `multi_select`. A replacement in the label keeps its pattern and its
 * replacement as typed, spaces included, since a pattern may be a single
 * space; the pattern must be one RE2 accepts.
 */
export const ruleSchema = z
	.object(fields)
	.superRefine((rule, context) => {
		for (const [index, condition] of rule.conditions.entries()) {
			const path = ["conditions", index];

			if (condition.conditionType !== "compound") {
				checkLeaf(condition, path, context);
				continue;
			}

			if (!isRuleOperatorOf("compound", condition.operator)) {
				issue(context, [...path, "operator"], "invalid_value");
			}

			for (const [position, child] of (condition.conditions ?? []).entries()) {
				if (child.conditionType === "compound") {
					issue(context, [...path, "conditions", position], "nested_group");
				} else {
					checkLeaf(child, [...path, "conditions", position], context);
				}
			}
		}

		if (rule.actions.length === 0) {
			issue(context, ["actions"], "action_required");
		}

		const seen = new Set<string>();

		for (const [index, action] of rule.actions.entries()) {
			if (seen.has(action.actionType)) {
				issue(context, ["actions", index], "duplicate_action");
			}

			seen.add(action.actionType);

			const value = action.value?.trim() ?? "";
			const path = ["actions", index, "value"];

			if (action.actionType === "replace_in_transaction_name") {
				checkReplacement(action, ["actions", index], context);
				continue;
			}

			if (action.replacement !== undefined && action.replacement !== null) {
				issue(context, ["actions", index, "replacement"], "invalid_value");
			}

			if (isValuelessAction(action.actionType)) {
				if (action.value !== undefined && action.value !== null) {
					issue(context, path, "invalid_value");
				}
			} else if (value === "") {
				issue(context, path, "too_small");
			} else if (action.actionType === "set_transaction_name" && value.length > LABEL_MAX_LENGTH) {
				issue(context, path, "too_big");
			} else if (action.actionType === "set_transaction_tags") {
				checkTags(value, path, context);
			} else if (action.actionType === "set_investment_activity_label" && !isActivityLabel(value)) {
				// Sure's executor writes nothing for any other value.
				issue(context, path, "invalid_value");
			}
		}
	})
	.transform((rule): RuleRequest => ({
		name: rule.name,
		effectiveDate: rule.effectiveDate,
		conditions: rule.conditions.map((condition): RuleConditionRequest => {
			if (condition.conditionType === "compound") {
				return {
					conditionType: "compound",
					operator: condition.operator === "or" ? "or" : "and",
					// A nested group is refused above; the filter only narrows the type.
					conditions: (condition.conditions ?? []).flatMap((child) =>
						child.conditionType === "compound"
							? []
							: [
									{
										conditionType: child.conditionType,
										operator: child.operator,
										value: storedValue(child),
									},
								],
					),
				};
			}

			return {
				conditionType: condition.conditionType,
				operator: condition.operator,
				value: storedValue(condition),
			};
		}),
		actions: rule.actions.map((action) =>
			action.actionType === "replace_in_transaction_name"
				? {
						actionType: action.actionType,
						value: action.value ?? "",
						replacement: action.replacement ?? "",
					}
				: {
						actionType: action.actionType,
						value: storedActionValue(action.actionType, action.value),
						replacement: null,
					},
		),
	}));

export type RuleFormInput = z.input<typeof ruleSchema>;
