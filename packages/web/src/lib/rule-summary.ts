import type { TFunction } from "i18next";

import { formatMoney, toMinorUnits } from "@archant/data/money";
import type { RuleConditionType, RuleOperator, RuleOperatorOf } from "@archant/data/rules";
import { isRuleOperatorOf } from "@archant/data/rules";

type OperatorKey = `rules.operators.${
	| "contains"
	| "equals"
	| "is"
	| "gt"
	| "gte"
	| "lt"
	| "lte"
	| "eq"
	| "ne"
	| "all"
	| "any"}`;

/**
 * The words each operator reads as, per condition type, as Story 8.1 names
 * them: « contient » or « est égal à » on a label, a symbol on an amount,
 * « est » on an account.
 */
export const OPERATOR_KEYS = {
	transaction_name: { like: "rules.operators.contains", "=": "rules.operators.equals" },
	transaction_amount: {
		">": "rules.operators.gt",
		">=": "rules.operators.gte",
		"<": "rules.operators.lt",
		"<=": "rules.operators.lte",
		"=": "rules.operators.eq",
		"!=": "rules.operators.ne",
	},
	transaction_account: { "=": "rules.operators.is" },
	compound: { and: "rules.operators.all", or: "rules.operators.any" },
} as const satisfies { [Type in RuleConditionType]: Record<RuleOperatorOf<Type>, OperatorKey> };

export function operatorKey(type: RuleConditionType, operator: RuleOperator): OperatorKey | null {
	if (type === "transaction_name") {
		return isRuleOperatorOf(type, operator) ? OPERATOR_KEYS[type][operator] : null;
	}

	if (type === "transaction_amount") {
		return isRuleOperatorOf(type, operator) ? OPERATOR_KEYS[type][operator] : null;
	}

	if (type === "transaction_account") {
		return isRuleOperatorOf(type, operator) ? OPERATOR_KEYS[type][operator] : null;
	}

	return isRuleOperatorOf(type, operator) ? OPERATOR_KEYS[type][operator] : null;
}

/** A condition as the API lists it: an amount's `value` is minor units of the reporting currency. */
export type SummaryCondition = {
	conditionType: RuleConditionType;
	operator: RuleOperator;
	value: string | null;
	conditions: readonly SummaryCondition[];
};

export type SummaryRule = {
	conditions: readonly SummaryCondition[];
	actions: readonly { value: string }[];
};

export type SummaryNames = {
	/** Account and category names by id; an id missing here was deleted. */
	accounts: ReadonlyMap<string, string>;
	categories: ReadonlyMap<string, string>;
	reportingCurrency: string;
};

/**
 * The condition the summary names, as in Sure: the first top-level one, or
 * the first of a group when the rule starts with one. `null` without any.
 */
function firstCondition(rule: SummaryRule): SummaryCondition | null {
	const [first] = rule.conditions;

	if (first === undefined) {
		return null;
	}

	return first.conditionType === "compound" ? (first.conditions[0] ?? null) : first;
}

function valueText(condition: SummaryCondition, names: SummaryNames, t: TFunction): string {
	const value = condition.value ?? "";

	if (condition.conditionType === "transaction_amount") {
		return formatMoney({ amount: toMinorUnits(Number(value)), currency: names.reportingCurrency });
	}

	if (condition.conditionType === "transaction_account") {
		return names.accounts.get(value) ?? t("rules.summary.deletedAccount");
	}

	return value;
}

/**
 * One line for a rule, as Sure writes it: « Si Libellé contient CARREFOUR,
 * alors Catégorie Courses », then « et N autres conditions » for the other
 * top-level conditions. « Toutes les opérations » without a condition.
 */
export function ruleSummary(rule: SummaryRule, names: SummaryNames, t: TFunction): string {
	const [action] = rule.actions;
	const category = action === undefined ? undefined : names.categories.get(action.value);
	const actionText =
		category === undefined
			? t("rules.summary.deletedCategory")
			: t("rules.summary.category", { name: category });
	const condition = firstCondition(rule);
	const key = condition === null ? null : operatorKey(condition.conditionType, condition.operator);
	const summary =
		condition === null || key === null
			? t("rules.summary.all", { action: actionText })
			: t("rules.summary.condition", {
					field: t(`rules.fields.${condition.conditionType}`),
					operator: t(key),
					value: valueText(condition, names, t),
					action: actionText,
				});
	const more = rule.conditions.length - 1;

	return more > 0 ? t("rules.summary.more", { summary, count: more }) : summary;
}
