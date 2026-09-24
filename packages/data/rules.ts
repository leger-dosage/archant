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
	"transaction_notes",
	"transaction_type",
	"compound",
] as const;

export type RuleConditionType = (typeof RULE_CONDITION_TYPES)[number];

export const RULE_OPERATORS = [
	"like",
	"=",
	">",
	">=",
	"<",
	"<=",
	"!=",
	"and",
	"or",
	"is_null",
] as const;

export type RuleOperator = (typeof RULE_OPERATORS)[number];

/**
 * The operators each condition type accepts, in the order the form offers
 * them. A compound condition is a group: `and` matches on all of its
 * conditions, `or` on any. `is_null` takes no value, as in Sure.
 */
export const RULE_OPERATORS_BY_TYPE = {
	transaction_name: ["like", "="],
	transaction_amount: [">", ">=", "<", "<=", "=", "!="],
	transaction_account: ["="],
	transaction_merchant: ["=", "is_null"],
	transaction_category: ["=", "is_null"],
	transaction_tag: ["=", "is_null"],
	transaction_notes: ["like", "=", "is_null"],
	transaction_type: ["="],
	compound: ["and", "or"],
} as const satisfies Record<RuleConditionType, readonly RuleOperator[]>;

export type RuleOperatorOf<Type extends RuleConditionType> =
	(typeof RULE_OPERATORS_BY_TYPE)[Type][number];

export const RULE_ACTION_TYPES = [
	"set_transaction_category",
	"set_transaction_merchant",
	"set_transaction_tags",
	"set_transaction_name",
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

/** Past this a rule's label condition is no longer a shop's name. */
export const RULE_VALUE_MAX_LENGTH = 200;

export const RULE_NAME_MAX_LENGTH = 100;
