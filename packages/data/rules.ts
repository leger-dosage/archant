/**
 * The closed lists of Sure's `Rule::Condition` and `Rule::Action`, kept out of
 * the schema module so the pure domain and the interface can read them
 * without reaching for the tables. The check constraints are built from them,
 * so the database refuses an unknown type or an operator of another type;
 * duplicate actions, nested groups and value formats are the API's checks
 * only.
 */
export const RULE_CONDITION_TYPES = [
	"transaction_name",
	"transaction_amount",
	"transaction_account",
	"transaction_merchant",
	"transaction_category",
	"transaction_tag",
	"transaction_details",
	"transaction_notes",
	"transaction_type",
	"compound",
] as const;

export type RuleConditionType = (typeof RULE_CONDITION_TYPES)[number];

export const RULE_OPERATORS = [
	"like",
	"not_like",
	"=",
	">",
	">=",
	"<",
	"<=",
	"!=",
	"and",
	"or",
	"is_null",
	"is_not_null",
] as const;

export type RuleOperator = (typeof RULE_OPERATORS)[number];

/**
 * The operators each condition type accepts, in the order the form offers
 * them: Sure's `OPERATORS_MAP["text"]` and `OPERATORS_MAP["select"]`. A tag
 * keeps the two operators Sure's `TransactionTag#apply` reads, the bank's
 * details the three `TransactionDetails#operators` overrides them with, and a
 * type its single one. A compound condition is a group: `and` matches on all of
 * its conditions, `or` on any.
 */
export const RULE_OPERATORS_BY_TYPE = {
	transaction_name: ["like", "not_like", "=", "!=", "is_null", "is_not_null"],
	transaction_amount: [">", ">=", "<", "<=", "=", "!="],
	transaction_account: ["=", "!=", "is_null", "is_not_null"],
	transaction_merchant: ["=", "!=", "is_null", "is_not_null"],
	transaction_category: ["=", "!=", "is_null", "is_not_null"],
	transaction_tag: ["=", "is_null"],
	transaction_details: ["like", "=", "is_null"],
	transaction_notes: ["like", "not_like", "=", "!=", "is_null", "is_not_null"],
	transaction_type: ["="],
	compound: ["and", "or"],
} as const satisfies Record<RuleConditionType, readonly RuleOperator[]>;

export type RuleOperatorOf<Type extends RuleConditionType> =
	(typeof RULE_OPERATORS_BY_TYPE)[Type][number];

/** Sure's `VALUELESS_OPERATORS`: they take no value, stored as null. */
export const VALUELESS_RULE_OPERATORS = [
	"is_null",
	"is_not_null",
] as const satisfies readonly RuleOperator[];

export type ValuelessRuleOperator = (typeof VALUELESS_RULE_OPERATORS)[number];

export function isValuelessOperator(operator: string): operator is ValuelessRuleOperator {
	const valueless: readonly string[] = VALUELESS_RULE_OPERATORS;

	return valueless.includes(operator);
}

export const RULE_ACTION_TYPES = [
	"set_transaction_category",
	"set_transaction_merchant",
	"set_transaction_tags",
	"set_transaction_name",
	"replace_in_transaction_name",
	"set_investment_activity_label",
	"exclude_transaction",
	"set_as_transfer_or_payment",
] as const;

export type RuleActionType = (typeof RULE_ACTION_TYPES)[number];

/** Exclusion needs nothing more, as in Sure: its stored value is null. */
export const VALUELESS_RULE_ACTION_TYPES = [
	"exclude_transaction",
] as const satisfies readonly RuleActionType[];

export function isValuelessAction(type: RuleActionType): boolean {
	const valueless: readonly RuleActionType[] = VALUELESS_RULE_ACTION_TYPES;

	return valueless.includes(type);
}

export function isRuleOperatorOf<Type extends RuleConditionType>(
	type: Type,
	operator: string,
): operator is RuleOperatorOf<Type> {
	const allowed: readonly string[] = RULE_OPERATORS_BY_TYPE[type];

	return allowed.includes(operator);
}

/**
 * A condition as the API returns it. `value` is stored text: the label, the
 * notes or the text searched in the bank's details, the amount as decimal
 * text in major units of any currency, a direction, or an account, merchant,
 * category or tag id; `null` for a valueless operator and for a group, whose
 * conditions follow.
 */
export type RuleConditionSnapshot = {
	conditionType: RuleConditionType;
	operator: RuleOperator;
	value: string | null;
	conditions: RuleConditionSnapshot[];
};

/**
 * A rule's name, conditions and actions as the API returns them. A run keeps
 * one, so a later edit of the rule does not rewrite what past runs applied.
 */
export type RuleSnapshot = {
	name: string | null;
	conditions: RuleConditionSnapshot[];
	/** `replacement` only for a replacement in the label, whose `value` is the pattern. */
	actions: { actionType: RuleActionType; value: string | null; replacement?: string | null }[];
};

/**
 * Sure's `RuleRun.execution_type`: `manual` for an application the owner
 * confirmed, `scheduled` for the run after a sync or an import.
 */
export const RULE_RUN_EXECUTION_TYPES = ["manual", "scheduled"] as const;

export type RuleRunExecutionType = (typeof RULE_RUN_EXECUTION_TYPES)[number];

/** Sure's `RuleRun.status`. */
export const RULE_RUN_STATUSES = ["pending", "success", "failed"] as const;

export type RuleRunStatus = (typeof RULE_RUN_STATUSES)[number];

/** Past this a rule's label condition is no longer a shop's name. */
export const RULE_VALUE_MAX_LENGTH = 200;

export const RULE_NAME_MAX_LENGTH = 100;

/**
 * The tag ids a tag action holds: Sure's `Rule::Action#value=` keeps them in
 * one value, comma-separated. Blanks and repeats are dropped, the order kept.
 */
export function tagIdsOf(value: string | null): string[] {
	return [
		...new Set(
			(value ?? "")
				.split(",")
				.map((id) => id.trim())
				.filter((id) => id !== ""),
		),
	];
}
