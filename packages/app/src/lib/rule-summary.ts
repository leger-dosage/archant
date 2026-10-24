import type { TFunction } from "i18next";

import { RULE_TYPE_VALUES } from "@archant/api/schemas/rules";
import { isActivityLabel } from "@archant/data/activity-labels";
import { isDecimalString } from "@archant/data/money";
import type {
	RuleActionType,
	RuleConditionType,
	RuleOperator,
	RuleOperatorOf,
} from "@archant/data/rules";
import { isRuleOperatorOf, isValuelessOperator, tagIdsOf } from "@archant/data/rules";

import { ACTIVITY_LABEL_NAMES } from "@/lib/activity-labels";

const isRuleTypeValue = (value: string): value is (typeof RULE_TYPE_VALUES)[number] =>
	RULE_TYPE_VALUES.some((known) => known === value);

type OperatorKey = `rules.operators.${
	| "contains"
	| "notContains"
	| "equals"
	| "notEquals"
	| "is"
	| "isNot"
	| "isNull"
	| "isNotNull"
	| "gt"
	| "gte"
	| "lt"
	| "lte"
	| "eq"
	| "ne"
	| "all"
	| "any"}`;

const TEXT_KEYS = {
	like: "rules.operators.contains",
	not_like: "rules.operators.notContains",
	"=": "rules.operators.equals",
	"!=": "rules.operators.notEquals",
	is_null: "rules.operators.isNull",
	is_not_null: "rules.operators.isNotNull",
} as const;

const SELECT_KEYS = {
	"=": "rules.operators.is",
	"!=": "rules.operators.isNot",
	is_null: "rules.operators.isNull",
	is_not_null: "rules.operators.isNotNull",
} as const;

/**
 * The words each operator reads as in a rule's summary, per condition type:
 * « contient », « ne contient pas », « est égal à » or « est différent de »
 * on a text, a symbol on an amount, « est » or « n'est pas » on a choice,
 * « est vide » and « n'est pas vide » for the valueless operators.
 */
const OPERATOR_KEYS = {
	transaction_name: TEXT_KEYS,
	transaction_amount: {
		">": "rules.operators.gt",
		">=": "rules.operators.gte",
		"<": "rules.operators.lt",
		"<=": "rules.operators.lte",
		"=": "rules.operators.eq",
		"!=": "rules.operators.ne",
	},
	transaction_account: SELECT_KEYS,
	transaction_merchant: SELECT_KEYS,
	transaction_category: SELECT_KEYS,
	transaction_tag: { "=": "rules.operators.is", is_null: "rules.operators.isNull" },
	transaction_details: {
		like: "rules.operators.contains",
		"=": "rules.operators.equals",
		is_null: "rules.operators.isNull",
	},
	transaction_notes: TEXT_KEYS,
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

type MenuKey = `rules.operatorLabels.${
	| "contains"
	| "doesNotContain"
	| "equalTo"
	| "notEqualTo"
	| "isEmpty"
	| "isNotEmpty"}`;

/** Sure's `rules.condition_filters.operators` on a text or a choice. */
const MENU_KEYS = {
	like: "rules.operatorLabels.contains",
	not_like: "rules.operatorLabels.doesNotContain",
	"=": "rules.operatorLabels.equalTo",
	"!=": "rules.operatorLabels.notEqualTo",
	is_null: "rules.operatorLabels.isEmpty",
	is_not_null: "rules.operatorLabels.isNotEmpty",
} as const satisfies Record<RuleOperatorOf<"transaction_name">, MenuKey>;

/**
 * The words the form's operator menu shows: Sure's on a text, a choice or a
 * type, the summary's symbols on an amount.
 */
export function operatorMenuKey(
	type: Exclude<RuleConditionType, "compound">,
	operator: RuleOperator,
): MenuKey | OperatorKey | null {
	if (type === "transaction_amount") {
		return operatorKey(type, operator);
	}

	if (!isRuleOperatorOf(type, operator)) {
		return null;
	}

	const keys: Partial<Record<RuleOperator, MenuKey>> = MENU_KEYS;

	return keys[operator] ?? null;
}

/** A condition as the API lists it: an amount's `value` is decimal text, in no currency. */
export type SummaryCondition = {
	conditionType: RuleConditionType;
	operator: RuleOperator;
	value: string | null;
	conditions: readonly SummaryCondition[];
};

export type SummaryRule = {
	conditions: readonly SummaryCondition[];
	actions: readonly {
		actionType: RuleActionType;
		value: string | null;
		replacement?: string | null | undefined;
	}[];
};

export type SummaryNames = {
	/** Names by id; an id missing here was deleted. */
	accounts: ReadonlyMap<string, string>;
	categories: ReadonlyMap<string, string>;
	merchants: ReadonlyMap<string, string>;
	tags: ReadonlyMap<string, string>;
};

/**
 * An amount as Sure's `value_display` prints it, with no currency since it
 * matches a line in any, written the French way with the decimals stored:
 * `"1234.50"` reads « 1 234,50 ».
 */
function amountText(value: string): string {
	if (!isDecimalString(value)) {
		return value;
	}

	const decimals = value.split(".")[1]?.length ?? 0;

	return new Intl.NumberFormat("fr-FR", {
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals,
	}).format(value);
}

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
			return amountText(value);
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
			// Sure's `value_display`: the tags still there, a deleted one left out.
			const tagNames = tagIdsOf(value).flatMap((tagId) => {
				const name = names.tags.get(tagId);

				return name === undefined ? [] : [name];
			});

			return tagNames.length === 0
				? t("rules.summary.deletedTag")
				: t("rules.summary.tag", { name: tagNames.join(", "), count: tagNames.length });
		}
		case "set_transaction_name":
			return t("rules.summary.rename", { name: value });
		case "replace_in_transaction_name": {
			const replacement = action.replacement ?? "";

			if (replacement === "") {
				return t("rules.summary.remove", { pattern: value });
			}

			// A space reads as nothing between quotation marks, and it is the usual replacement.
			return replacement.trim() === ""
				? t("rules.summary.replaceBySpace", { pattern: value })
				: t("rules.summary.replace", { pattern: value, replacement });
		}
		case "set_investment_activity_label":
			return t("rules.summary.activityLabel", {
				name: isActivityLabel(value) ? t(ACTIVITY_LABEL_NAMES[value]) : value,
			});
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
			: isValuelessOperator(condition.operator)
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
