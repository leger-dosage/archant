import { z } from "zod";

import type { CurrencyCode } from "@archant/data/money";
import { parseAmount } from "@archant/data/money";
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
} from "@archant/data/rules";

/** Past this a rule is no longer read at a glance; Sure sets no limit. */
export const MAX_RULE_CONDITIONS = 50;

// What the route checks: the body's shape, every value as text, so the typed
// client knows it. The service parses it afterwards with `ruleSchema`, in the
// reporting currency.
const conditionBody = z.object({
	conditionType: z.string(),
	operator: z.string(),
	value: z.string().nullable().optional(),
});

export const ruleBodySchema = z.object({
	name: z.string().nullable().optional(),
	effectiveDate: z.string().nullable().optional(),
	conditions: z.array(conditionBody.extend({ conditions: z.array(conditionBody).optional() })),
	actions: z.array(z.object({ actionType: z.string(), value: z.string().nullable().optional() })),
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
		z.object({ actionType: z.enum(RULE_ACTION_TYPES), value: z.string().nullable().optional() }),
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

/** A leaf condition's operator and value, reported under `path`. */
function checkLeaf(
	leaf: Leaf,
	path: (string | number)[],
	currency: CurrencyCode,
	context: z.core.$RefinementCtx,
) {
	if (!isRuleOperatorOf(leaf.conditionType, leaf.operator)) {
		issue(context, [...path, "operator"], "invalid_value");
	}

	const value = leaf.value?.trim() ?? "";

	if (value === "") {
		issue(context, [...path, "value"], "too_small");

		return;
	}

	if (leaf.conditionType === "transaction_name" && value.length > RULE_VALUE_MAX_LENGTH) {
		issue(context, [...path, "value"], "too_big");
	}

	if (leaf.conditionType === "transaction_amount") {
		const amount = parseAmount(value, currency);

		// Compared with the absolute amount: a sign would never match.
		if (amount === null || amount < 0) {
			issue(context, [...path, "value"], "invalid_amount");
		}
	}
}

/** One stored value: the trimmed text, the amount in minor units. */
function storedValue(leaf: Leaf, currency: CurrencyCode): string {
	const value = leaf.value?.trim() ?? "";

	return leaf.conditionType === "transaction_amount" ? String(parseAmount(value, currency)) : value;
}

export type RuleLeafRequest = {
	conditionType: Exclude<RuleConditionType, "compound">;
	operator: RuleOperator;
	value: string;
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
	actions: { actionType: RuleActionType; value: string }[];
};

/**
 * The full check of a rule, shared with the interface's form resolver so the
 * form reports the API's field codes. Built per currency: the amount is typed
 * in the reporting currency and stored in its minor units. Groups nest one
 * level deep, a rule needs one action at least, and no action type twice, as
 * in Sure.
 */
export function ruleSchema(currency: CurrencyCode) {
	return z
		.object(fields)
		.superRefine((rule, context) => {
			for (const [index, condition] of rule.conditions.entries()) {
				const path = ["conditions", index];

				if (condition.conditionType !== "compound") {
					checkLeaf(condition, path, currency, context);
					continue;
				}

				if (!isRuleOperatorOf("compound", condition.operator)) {
					issue(context, [...path, "operator"], "invalid_value");
				}

				for (const [position, child] of (condition.conditions ?? []).entries()) {
					if (child.conditionType === "compound") {
						issue(context, [...path, "conditions", position], "nested_group");
					} else {
						checkLeaf(child, [...path, "conditions", position], currency, context);
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

				if ((action.value?.trim() ?? "") === "") {
					issue(context, ["actions", index, "value"], "too_small");
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
											value: storedValue(child, currency),
										},
									],
						),
					};
				}

				return {
					conditionType: condition.conditionType,
					operator: condition.operator,
					value: storedValue(condition, currency),
				};
			}),
			actions: rule.actions.map((action) => ({
				actionType: action.actionType,
				value: action.value?.trim() ?? "",
			})),
		}));
}

export type RuleFormInput = z.input<ReturnType<typeof ruleSchema>>;
