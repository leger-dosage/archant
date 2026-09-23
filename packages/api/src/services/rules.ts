import type { Condition, LeafCondition, Rule } from "../domain/rules/matching.ts";
import type {
	RuleConditionRequest,
	RuleEnabledInput,
	RuleInput,
	RuleLeafRequest,
	RuleRequest,
} from "../schemas/rules.ts";
import type { ServiceDeps } from "./deps.ts";

import { asc, eq, inArray } from "drizzle-orm";

import { toMinorUnits } from "@archant/data/money";
import type { RuleActionType, RuleConditionType, RuleOperator } from "@archant/data/rules";
import { isRuleOperatorOf } from "@archant/data/rules";
import { accounts } from "@archant/data/schema/accounts";
import { categories } from "@archant/data/schema/categories";
import { ruleActions, ruleConditions, rules } from "@archant/data/schema/rules";
import type { NewRuleCondition, RuleCondition as RuleConditionRow } from "@archant/data/types";

import { AppError } from "../lib/errors.ts";
import { validationError } from "../lib/zod-error.ts";
import { ruleEnabledSchema, ruleSchema } from "../schemas/rules.ts";
import { getReportingCurrency } from "./settings.ts";

/**
 * A condition as the interface reads it. `value` is stored text: the label,
 * the amount in minor units of the reporting currency, or an account id;
 * `null` for a group, whose conditions follow.
 */
export type RuleConditionData = {
	conditionType: RuleConditionType;
	operator: RuleOperator;
	value: string | null;
	conditions: RuleConditionData[];
};

export type RuleData = {
	id: string;
	name: string | null;
	enabled: boolean;
	effectiveDate: string | null;
	conditions: RuleConditionData[];
	/** `value` is a category id, which may name a deleted category. */
	actions: { actionType: RuleActionType; value: string }[];
};

type Db = ServiceDeps["db"];

const notFound = () => new AppError("NOT_FOUND", "No rule has this id.");

type RuleRow = typeof rules.$inferSelect;
type ActionRow = typeof ruleActions.$inferSelect;

/** The rules with their conditions and actions, in application order. */
async function readRules(db: Pick<Db, "select">, only: { enabled?: boolean; id?: string } = {}) {
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

type ReadRule = { row: RuleRow; conditions: RuleConditionRow[]; actions: ActionRow[] };

function conditionTree(
	conditions: readonly RuleConditionRow[],
	parentId: string | null,
): RuleConditionData[] {
	return conditions
		.filter((condition) => condition.parentId === parentId)
		.map((condition) => ({
			conditionType: condition.conditionType,
			operator: condition.operator,
			value: condition.value,
			conditions:
				condition.conditionType === "compound" ? conditionTree(conditions, condition.id) : [],
		}));
}

function toData({ row, conditions, actions }: ReadRule): RuleData {
	return {
		id: row.id,
		name: row.name,
		enabled: row.enabled,
		effectiveDate: row.effectiveDate,
		conditions: conditionTree(conditions, null),
		actions: actions.map((action) => ({ actionType: action.actionType, value: action.value })),
	};
}

/** Every rule, in the order they apply. */
export async function listRules(deps: ServiceDeps): Promise<RuleData[]> {
	return (await readRules(deps.db)).map(toData);
}

async function getRule(db: Pick<Db, "select">, id: string): Promise<RuleData> {
	const [found] = await readRules(db, { id });

	if (found === undefined) {
		throw notFound();
	}

	return toData(found);
}

function parse(input: RuleInput): RuleRequest {
	const parsed = ruleSchema(getReportingCurrency()).safeParse(input);

	if (!parsed.success) {
		throw validationError(parsed.error);
	}

	return parsed.data;
}

/**
 * Refuses an account or a category that does not exist, on the value that
 * names it. Checked on save only: one deleted later leaves the rule inert.
 */
async function assertReferencesExist(db: Pick<Db, "select">, rule: RuleRequest): Promise<void> {
	const accountValues = rule.conditions.flatMap((condition, index) => {
		const leaves: [RuleLeafRequest, string][] =
			condition.conditionType === "compound"
				? condition.conditions.map((child, position) => [
						child,
						`conditions.${index}.conditions.${position}.value`,
					])
				: [[condition, `conditions.${index}.value`]];

		return leaves.filter(([leaf]) => leaf.conditionType === "transaction_account");
	});
	const accountIds = accountValues.map(([leaf]) => leaf.value);
	const categoryIds = rule.actions.map((action) => action.value);
	const [knownAccounts, knownCategories] = await Promise.all([
		accountIds.length === 0
			? []
			: db.select({ id: accounts.id }).from(accounts).where(inArray(accounts.id, accountIds)),
		db.select({ id: categories.id }).from(categories).where(inArray(categories.id, categoryIds)),
	]);
	const accountSet = new Set(knownAccounts.map((row) => row.id));
	const categorySet = new Set(knownCategories.map((row) => row.id));
	const fields = [
		...accountValues
			.filter(([leaf]) => !accountSet.has(leaf.value))
			.map(([, path]) => ({ path, code: "invalid_value" })),
		...rule.actions.flatMap((action, index) =>
			categorySet.has(action.value)
				? []
				: [{ path: `actions.${index}.value`, code: "invalid_value" }],
		),
	];

	if (fields.length > 0) {
		throw new AppError("VALIDATION_ERROR", "The request is invalid.", fields);
	}
}

type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Writes a rule's conditions and actions, in the form's order. */
async function insertParts(tx: Transaction, ruleId: string, rule: RuleRequest): Promise<void> {
	const rows = rule.conditions.flatMap(
		(condition: RuleConditionRequest, position): NewRuleCondition[] => {
			const id = crypto.randomUUID();

			if (condition.conditionType !== "compound") {
				return [{ id, ruleId, parentId: null, position, ...condition }];
			}

			return [
				{
					id,
					ruleId,
					parentId: null,
					position,
					conditionType: condition.conditionType,
					operator: condition.operator,
					value: null,
				},
				...condition.conditions.map((child, childPosition) => ({
					id: crypto.randomUUID(),
					ruleId,
					parentId: id,
					position: childPosition,
					...child,
				})),
			];
		},
	);

	if (rows.length > 0) {
		await tx.insert(ruleConditions).values(rows);
	}

	await tx.insert(ruleActions).values(
		rule.actions.map((action, position) => ({
			id: crypto.randomUUID(),
			ruleId,
			position,
			actionType: action.actionType,
			value: action.value,
		})),
	);
}

/** Creates a rule, enabled at once, as in Sure. */
export async function createRule(deps: ServiceDeps, input: RuleInput): Promise<RuleData> {
	const rule = parse(input);
	const id = crypto.randomUUID();

	await deps.db.transaction(
		async (tx) => {
			await assertReferencesExist(tx, rule);
			const now = Date.now();

			await tx.insert(rules).values({
				id,
				name: rule.name,
				enabled: true,
				effectiveDate: rule.effectiveDate,
				createdAt: now,
				updatedAt: now,
			});
			await insertParts(tx, id, rule);
		},
		{ behavior: "immediate" },
	);

	return getRule(deps.db, id);
}

async function assertExists(db: Pick<Db, "select">, id: string): Promise<void> {
	const row = await db.select({ id: rules.id }).from(rules).where(eq(rules.id, id)).get();

	if (row === undefined) {
		throw notFound();
	}
}

/**
 * Replaces a rule's name, start date, conditions and actions. It keeps its
 * place in the order and its switch; what it wrote before stays.
 */
export async function updateRule(
	deps: ServiceDeps,
	id: string,
	input: RuleInput,
): Promise<RuleData> {
	const rule = parse(input);

	await deps.db.transaction(
		async (tx) => {
			await assertExists(tx, id);
			await assertReferencesExist(tx, rule);
			await tx
				.update(rules)
				.set({ name: rule.name, effectiveDate: rule.effectiveDate, updatedAt: Date.now() })
				.where(eq(rules.id, id));
			// Sub-conditions go with their group through the cascade.
			await tx.delete(ruleConditions).where(eq(ruleConditions.ruleId, id));
			await tx.delete(ruleActions).where(eq(ruleActions.ruleId, id));
			await insertParts(tx, id, rule);
		},
		{ behavior: "immediate" },
	);

	return getRule(deps.db, id);
}

/** Turns a rule on or off. Off, it leaves what it wrote in place. */
export async function setRuleEnabled(
	deps: ServiceDeps,
	id: string,
	input: RuleEnabledInput,
): Promise<RuleData> {
	const { enabled } = ruleEnabledSchema.parse(input);

	await deps.db.transaction(
		async (tx) => {
			await assertExists(tx, id);
			await tx.update(rules).set({ enabled, updatedAt: Date.now() }).where(eq(rules.id, id));
		},
		{ behavior: "immediate" },
	);

	return getRule(deps.db, id);
}

/** Deletes a rule with its conditions and actions; what it wrote stays. */
export async function deleteRule(deps: ServiceDeps, id: string): Promise<{ id: string }> {
	return deps.db.transaction(
		async (tx) => {
			await assertExists(tx, id);
			await tx.delete(rules).where(eq(rules.id, id));

			return { id };
		},
		{ behavior: "immediate" },
	);
}

function malformed(): Error {
	// The check constraints and the schema make this unreachable; a row edited
	// by hand would otherwise be dropped, and the rule would match more.
	return new Error("A stored rule condition is malformed.");
}

function toLeaf(condition: RuleConditionRow, knownAccounts: ReadonlySet<string>): LeafCondition {
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
		return { type: conditionType, operator, accountId: knownAccounts.has(value) ? value : null };
	}

	throw malformed();
}

function toCondition(
	condition: RuleConditionRow,
	all: readonly RuleConditionRow[],
	knownAccounts: ReadonlySet<string>,
): Condition {
	if (condition.conditionType !== "compound") {
		return toLeaf(condition, knownAccounts);
	}

	if (!isRuleOperatorOf("compound", condition.operator)) {
		throw malformed();
	}

	return {
		type: "compound",
		operator: condition.operator,
		conditions: all
			.filter((child) => child.parentId === condition.id)
			.map((child) => toLeaf(child, knownAccounts)),
	};
}

/**
 * The enabled rules as the evaluator reads them, in application order, with
 * deleted accounts and categories resolved to `null`. Step 5 of
 * `ledger.ingest` calls it once per ingest, inside its transaction.
 */
export async function loadEnabledRules(db: Pick<Db, "select">): Promise<Rule[]> {
	const found = await readRules(db, { enabled: true });

	if (found.length === 0) {
		return [];
	}

	const [accountRows, categoryRows] = await Promise.all([
		db.select({ id: accounts.id }).from(accounts),
		db.select({ id: categories.id }).from(categories),
	]);
	const knownAccounts = new Set(accountRows.map((row) => row.id));
	const knownCategories = new Set(categoryRows.map((row) => row.id));

	return found.map(({ row, conditions, actions }) => ({
		id: row.id,
		effectiveDate: row.effectiveDate,
		conditions: conditions
			.filter((condition) => condition.parentId === null)
			.map((condition) => toCondition(condition, conditions, knownAccounts)),
		actions: actions.map((action) => ({
			type: action.actionType,
			// A deleted category makes the action write nothing, as in Sure.
			categoryId: knownCategories.has(action.value) ? action.value : null,
		})),
	}));
}
