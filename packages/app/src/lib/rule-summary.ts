import type { TFunction } from "i18next";

import { RULE_TYPE_VALUES } from "@archant/api/schemas/rules";
import { formatMoney, toMinorUnits } from "@archant/data/money";
import type {
	RuleActionType,
	RuleConditionType,
	RuleOperator,
	RuleOperatorOf,
} from "@archant/data/rules";
import { isRuleOperatorOf } from "@archant/data/rules";

const isRuleTypeValue = (value: string): value is (typeof RULE_TYPE_VALUES)[number] =>
	RULE_TYPE_VALUES.some((known) => known === value);

type OperatorKey = `rules.operators.${
	| "contains"
	| "equals"
	| "is"
	| "isNull"
	| "gt"
	| "gte"
	| "lt"
	| "lte"
	| "eq"
	| "ne"
	| "all"
	| "any"}`;

/**
 * The words each operator reads as, per condition type: « contient » or
 * « est égal à » on a text, a symbol on an amount, « est » on a choice,
 * « est vide » for `is_null`.
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
	transaction_merchant: { "=": "rules.operators.is", is_null: "rules.operators.isNull" },
	transaction_category: { "=": "rules.operators.is", is_null: "rules.operators.isNull" },
	transaction_tag: { "=": "rules.operators.is", is_null: "rules.operators.isNull" },
	transaction_notes: {
		like: "rules.operators.contains",
		"=": "rules.operators.equals",
		is_null: "rules.operators.isNull",
	},
	transaction_type: { "=": "rules.operators.is" },
	compound: { and: "rules.operators.all", or: "rules.operators.any" },
} as const satisfies { [Type in RuleConditionType]: Record<RuleOperatorOf<Type>, OperatorKey> };

export function operatorKey(type: RuleConditionType, operator: RuleOperator): OperatorKey | null {
	if (!isRuleOperatorOf(type, operator)) {
		return null;
	}

	const keys: Partial<Record<RuleOperator, OperatorKey>> = OPERATOR_KEYS[type];

	return keys[operator] ?? null;
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
	actions: readonly { actionType: RuleActionType; value: string | null }[];
};

export type SummaryNames = {
	/** Names by id; an id missing here was deleted. */
	accounts: ReadonlyMap<string, string>;
	categories: ReadonlyMap<string, string>;
	merchants: ReadonlyMap<string, string>;
	tags: ReadonlyMap<string, string>;
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

	switch (condition.conditionType) {
		case "transaction_amount":
			return formatMoney({
				amount: toMinorUnits(Number(value)),
				currency: names.reportingCurrency,
			});
		case "transaction_account":
			return names.accounts.get(value) ?? t("rules.summary.deletedAccount");
		case "transaction_merchant":
			return names.merchants.get(value) ?? t("rules.summary.deletedMerchant");
		case "transaction_category":
			return names.categories.get(value) ?? t("rules.summary.deletedCategory");
		case "transaction_tag":
			return names.tags.get(value) ?? t("rules.summary.deletedTag");
		case "transaction_type":
			return isRuleTypeValue(value) ? t(`rules.types.${value}`) : value;
		default:
			return value;
	}
}

/** The first action in words, as Sure's summary names it: « Catégorie Courses », « Exclure ». */
function actionText(action: SummaryRule["actions"][number], names: SummaryNames, t: TFunction) {
	const value = action.value ?? "";

	switch (action.actionType) {
		case "set_transaction_category": {
			const name = names.categories.get(value);

			return name === undefined
				? t("rules.summary.deletedCategory")
				: t("rules.summary.category", { name });
		}
		case "set_transaction_merchant": {
			const name = names.merchants.get(value);

			return name === undefined
				? t("rules.summary.deletedMerchant")
				: t("rules.summary.merchant", { name });
		}
		case "set_transaction_tags": {
			const name = names.tags.get(value);

			return name === undefined ? t("rules.summary.deletedTag") : t("rules.summary.tag", { name });
		}
		case "set_transaction_name":
			return t("rules.summary.rename", { name: value });
		case "exclude_transaction":
			return t("rules.summary.exclude");
		default: {
			const name = names.accounts.get(value);

			return name === undefined
				? t("rules.summary.deletedAccount")
				: t("rules.summary.transfer", { name });
		}
	}
}

/**
 * One line for a rule, as Sure writes it: « Si Libellé contient CARREFOUR,
 * alors Catégorie Courses », « et N autres actions » after the first action,
 * then « et N autres conditions » for the other top-level conditions.
 * « Toutes les opérations » without a condition.
 */
export function ruleSummary(rule: SummaryRule, names: SummaryNames, t: TFunction): string {
	const [action, ...otherActions] = rule.actions;
	const first =
		action === undefined ? t("rules.summary.deletedCategory") : actionText(action, names, t);
	const actions =
		otherActions.length > 0
			? t("rules.summary.moreActions", { summary: first, count: otherActions.length })
			: first;
	const condition = firstCondition(rule);
	const key = condition === null ? null : operatorKey(condition.conditionType, condition.operator);
	const summary =
		condition === null || key === null
			? t("rules.summary.all", { action: actions })
			: condition.operator === "is_null"
				? t("rules.summary.emptyCondition", {
						field: t(`rules.fields.${condition.conditionType}`),
						operator: t(key),
						action: actions,
					})
				: t("rules.summary.condition", {
						field: t(`rules.fields.${condition.conditionType}`),
						operator: t(key),
						value: valueText(condition, names, t),
						action: actions,
					});
	const more = rule.conditions.length - 1;

	return more > 0 ? t("rules.summary.more", { summary, count: more }) : summary;
}
