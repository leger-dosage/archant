import type { Condition, LeafCondition, Rule, RuleAction } from "../domain/rules/matching.ts";
import type { ServiceDeps } from "./deps.ts";

import { asc, eq, inArray } from "drizzle-orm";

import { toMinorUnits } from "@archant/data/money";
import type { RuleConditionType } from "@archant/data/rules";
import { isRuleOperatorOf, isValuelessAction } from "@archant/data/rules";
import { accounts } from "@archant/data/schema/accounts";
import { categories } from "@archant/data/schema/categories";
import { merchants } from "@archant/data/schema/merchants";
import { ruleActions, ruleConditions, rules } from "@archant/data/schema/rules";
import { tags } from "@archant/data/schema/tags";
import type {
	RuleAction as RuleActionRow,
	RuleCondition as RuleConditionRow,
} from "@archant/data/types";

import { DIRECTIONS } from "../domain/cash-flow.ts";
import { compileLabelPattern } from "../domain/rules/label-pattern.ts";

type Db = ServiceDeps["db"];

type RuleRow = typeof rules.$inferSelect;
type ActionRow = typeof ruleActions.$inferSelect;

/** The rules with their conditions and actions, in application order. */
export async function readRules(
	db: Pick<Db, "select">,
	only: { enabled?: boolean; id?: string } = {},
) {
	const filter =
		only.id === undefined
			? only.enabled === undefined
				? undefined
				: eq(rules.enabled, only.enabled)
			: eq(rules.id, only.id);
	// Creation order, as in Sure; the id breaks a tie between two rules saved
	// in the same millisecond.
	const rows = await db
		.select()
		.from(rules)
		.where(filter)
		.orderBy(asc(rules.createdAt), asc(rules.id));
	const ids = rows.map((row) => row.id);

	if (ids.length === 0) {
		return [];
	}

	const [conditions, actions] = await Promise.all([
		db
			.select()
			.from(ruleConditions)
			.where(inArray(ruleConditions.ruleId, ids))
			.orderBy(asc(ruleConditions.position)),
		db
			.select()
			.from(ruleActions)
			.where(inArray(ruleActions.ruleId, ids))
			.orderBy(asc(ruleActions.position)),
	]);

	return rows.map((row) => ({
		row,
		conditions: conditions.filter((condition) => condition.ruleId === row.id),
		actions: actions.filter((action) => action.ruleId === row.id),
	}));
}

export type ReadRule = { row: RuleRow; conditions: RuleConditionRow[]; actions: ActionRow[] };

/** The table a condition or an action names a row of, by its type. */
export type Reference = "account" | "merchant" | "category" | "tag";

export const CONDITION_REFERENCES: Partial<Record<RuleConditionType, Reference>> = {
	transaction_account: "account",
	transaction_merchant: "merchant",
	transaction_category: "category",
	transaction_tag: "tag",
};

/** Every id of `reference`'s table among `ids`, all of them when `ids` is absent. */
export async function existing(
	db: Pick<Db, "select">,
	reference: Reference,
	ids?: string[],
): Promise<Set<string>> {
	const rows = await {
		account: () =>
			db
				.select({ id: accounts.id })
				.from(accounts)
				.where(ids === undefined ? undefined : inArray(accounts.id, ids)),
		merchant: () =>
			db
				.select({ id: merchants.id })
				.from(merchants)
				.where(ids === undefined ? undefined : inArray(merchants.id, ids)),
		category: () =>
			db
				.select({ id: categories.id })
				.from(categories)
				.where(ids === undefined ? undefined : inArray(categories.id, ids)),
		tag: () =>
			db
				.select({ id: tags.id })
				.from(tags)
				.where(ids === undefined ? undefined : inArray(tags.id, ids)),
	}[reference]();

	return new Set(rows.map((row) => row.id));
}

function malformed(): Error {
	// The check constraints and the schema make this unreachable; a row edited
	// by hand would otherwise be dropped, and the rule would match more.
	return new Error("A stored rule condition or action is malformed.");
}

/** The ids still in each table, so a deleted one resolves to `null`. */
type Known = Record<Reference, ReadonlySet<string>>;

function toLeaf(condition: RuleConditionRow, known: Known): LeafCondition {
	const value = condition.value ?? "";
	const { conditionType, operator } = condition;

	if (conditionType === "transaction_name" && isRuleOperatorOf(conditionType, operator)) {
		return { type: conditionType, operator, value };
	}

	if (conditionType === "transaction_amount" && isRuleOperatorOf(conditionType, operator)) {
		return { type: conditionType, operator, value: toMinorUnits(Number(value)) };
	}

	if (conditionType === "transaction_account" && isRuleOperatorOf(conditionType, operator)) {
		// A deleted account makes the condition match nothing, as in Sure.
		return { type: conditionType, operator, accountId: known.account.has(value) ? value : null };
	}

	if (conditionType === "transaction_notes" && isRuleOperatorOf(conditionType, operator)) {
		return operator === "is_null"
			? { type: conditionType, operator }
			: { type: conditionType, operator, value };
	}

	const direction = DIRECTIONS.find((candidate) => candidate === value);

	if (conditionType === "transaction_type" && direction !== undefined) {
		return { type: conditionType, operator: "=", value: direction };
	}

	const reference = CONDITION_REFERENCES[conditionType];

	if (
		(conditionType === "transaction_merchant" ||
			conditionType === "transaction_category" ||
			conditionType === "transaction_tag") &&
		reference !== undefined &&
		isRuleOperatorOf(conditionType, operator)
	) {
		// A deleted row makes `=` match nothing, as in Sure.
		return {
			type: conditionType,
			operator,
			id: operator === "=" && known[reference].has(value) ? value : null,
		};
	}

	throw malformed();
}

/** An action as the evaluator reads it, a deleted row resolved to `null`. */
function toAction(action: RuleActionRow, known: Known): RuleAction {
	// Only an exclusion is stored without a value; a rename read as "" would blank labels.
	if (action.value === null && !isValuelessAction(action.actionType)) {
		throw malformed();
	}

	const value = action.value ?? "";
	const ifKnown = (reference: Reference) => (known[reference].has(value) ? value : null);

	switch (action.actionType) {
		case "set_transaction_category":
			return { type: action.actionType, categoryId: ifKnown("category") };
		case "set_transaction_merchant":
			return { type: action.actionType, merchantId: ifKnown("merchant") };
		case "set_transaction_tags":
			return { type: action.actionType, tagId: ifKnown("tag") };
		case "set_transaction_name":
			return { type: action.actionType, label: value };
		case "replace_in_transaction_name": {
			// Compiled once for every row of the load. An empty pattern compiles
			// and would match between every character; it and one RE2 refuses
			// could only have been written by hand.
			const pattern = value === "" ? null : compileLabelPattern(value);

			if (pattern === null) {
				throw malformed();
			}

			return { type: action.actionType, pattern, replacement: action.replacement ?? "" };
		}
		case "exclude_transaction":
			return { type: action.actionType };
		default:
			return { type: action.actionType, accountId: ifKnown("account") };
	}
}

function toCondition(
	condition: RuleConditionRow,
	all: readonly RuleConditionRow[],
	known: Known,
): Condition {
	if (condition.conditionType !== "compound") {
		return toLeaf(condition, known);
	}

	if (!isRuleOperatorOf("compound", condition.operator)) {
		throw malformed();
	}

	return {
		type: "compound",
		operator: condition.operator,
		conditions: all
			.filter((child) => child.parentId === condition.id)
			.map((child) => toLeaf(child, known)),
	};
}

/** The ids still in each table, read once per load. */
export async function knownReferences(db: Pick<Db, "select">): Promise<Known> {
	const [account, merchant, category, tag] = await Promise.all([
		existing(db, "account"),
		existing(db, "merchant"),
		existing(db, "category"),
		existing(db, "tag"),
	]);

	return { account, merchant, category, tag };
}

export function toRule({ row, conditions, actions }: ReadRule, known: Known): Rule {
	return {
		id: row.id,
		effectiveDate: row.effectiveDate,
		conditions: conditions
			.filter((condition) => condition.parentId === null)
			.map((condition) => toCondition(condition, conditions, known)),
		actions: actions.map((action) => toAction(action, known)),
	};
}

/**
 * The enabled rules as the evaluator reads them, in application order, with
 * deleted accounts, merchants, categories and tags resolved to `null`. Step
 * 5 of `ingest` in `ledger/ingest.ts` calls it once per ingest, inside its
 * transaction.
 */
export async function loadEnabledRules(db: Pick<Db, "select">): Promise<Rule[]> {
	const found = await readRules(db, { enabled: true });

	if (found.length === 0) {
		return [];
	}

	const known = await knownReferences(db);

	return found.map((rule) => toRule(rule, known));
}
