import type { IsoDate } from "../domain/dates.ts";
import type { Condition, LeafCondition, Rule, RuleAction } from "../domain/rules/matching.ts";
import type {
	RuleConditionRequest,
	RuleEnabledInput,
	RuleInput,
	RuleLeafRequest,
	RuleRequest,
} from "../schemas/rules.ts";
import type { ServiceDeps } from "./deps.ts";

import { asc, count, desc, eq, inArray } from "drizzle-orm";

import { toMinorUnits } from "@archant/data/money";
import type {
	RuleActionType,
	RuleConditionSnapshot,
	RuleConditionType,
	RuleSnapshot,
} from "@archant/data/rules";
import { isRuleOperatorOf, isValuelessAction } from "@archant/data/rules";
import { accounts } from "@archant/data/schema/accounts";
import { categories } from "@archant/data/schema/categories";
import { merchants } from "@archant/data/schema/merchants";
import { ruleActions, ruleConditions, ruleRuns, rules } from "@archant/data/schema/rules";
import { tags } from "@archant/data/schema/tags";
import type {
	NewRuleCondition,
	RuleAction as RuleActionRow,
	RuleCondition as RuleConditionRow,
} from "@archant/data/types";

import { DIRECTIONS } from "../domain/cash-flow.ts";
import { planActions } from "../domain/rules/matching.ts";
import { AppError } from "../lib/errors.ts";
import { validationError } from "../lib/zod-error.ts";
import { ruleEnabledSchema, ruleSchema } from "../schemas/rules.ts";
import { MAX_TAGS_PER_TRANSACTION } from "../schemas/transactions.ts";
import { applyRulePlanToHistory, ruleCandidates } from "./ledger.ts";
import { getReportingCurrency } from "./settings.ts";

/**
 * An action's `value` is a category, merchant, tag or account id, which may
 * name a deleted one; the new label of a rename; `null` for an exclusion.
 */
export type RuleData = RuleSnapshot & {
	id: string;
	enabled: boolean;
	effectiveDate: string | null;
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
): RuleConditionSnapshot[] {
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

/** The table a condition or an action names a row of, by its type. */
type Reference = "account" | "merchant" | "category" | "tag";

const CONDITION_REFERENCES: Partial<Record<RuleConditionType, Reference>> = {
	transaction_account: "account",
	transaction_merchant: "merchant",
	transaction_category: "category",
	transaction_tag: "tag",
};

const ACTION_REFERENCES: Partial<Record<RuleActionType, Reference>> = {
	set_transaction_category: "category",
	set_transaction_merchant: "merchant",
	set_transaction_tags: "tag",
	set_as_transfer_or_payment: "account",
};

/** Every id of `reference`'s table among `ids`, all of them when `ids` is absent. */
async function existing(
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

/**
 * Refuses an account, merchant, category or tag that does not exist, on the
 * value that names it. Checked on save only: one deleted later leaves the
 * rule inert.
 */
async function assertReferencesExist(db: Pick<Db, "select">, rule: RuleRequest): Promise<void> {
	const named: { reference: Reference; id: string; path: string }[] = [];
	const name = (reference: Reference | undefined, id: string | null, path: string) => {
		if (reference !== undefined && id !== null) {
			named.push({ reference, id, path });
		}
	};

	for (const [index, condition] of rule.conditions.entries()) {
		const leaves: [RuleLeafRequest, string][] =
			condition.conditionType === "compound"
				? condition.conditions.map((child, position) => [
						child,
						`conditions.${index}.conditions.${position}.value`,
					])
				: [[condition, `conditions.${index}.value`]];

		for (const [leaf, path] of leaves) {
			name(CONDITION_REFERENCES[leaf.conditionType], leaf.value, path);
		}
	}

	for (const [index, action] of rule.actions.entries()) {
		name(ACTION_REFERENCES[action.actionType], action.value, `actions.${index}.value`);
	}

	const missing = (
		await Promise.all(
			(["account", "merchant", "category", "tag"] as const).map(async (reference) => {
				const wanted = named.filter((item) => item.reference === reference);

				if (wanted.length === 0) {
					return [];
				}

				const found = await existing(
					db,
					reference,
					wanted.map((item) => item.id),
				);

				return wanted.filter((item) => !found.has(item.id)).map((item) => item.path);
			}),
		)
	).flat();

	if (missing.length > 0) {
		// In the body's order, conditions before actions, as the form lists them.
		const fields = named
			.filter((item) => missing.includes(item.path))
			.map(({ path }) => ({ path, code: "invalid_value" }));

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
async function knownReferences(db: Pick<Db, "select">): Promise<Known> {
	const [account, merchant, category, tag] = await Promise.all([
		existing(db, "account"),
		existing(db, "merchant"),
		existing(db, "category"),
		existing(db, "tag"),
	]);

	return { account, merchant, category, tag };
}

function toRule({ row, conditions, actions }: ReadRule, known: Known): Rule {
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
 * 5 of `ledger.ingest` calls it once per ingest, inside its transaction.
 */
export async function loadEnabledRules(db: Pick<Db, "select">): Promise<Rule[]> {
	const found = await readRules(db, { enabled: true });

	if (found.length === 0) {
		return [];
	}

	const known = await knownReferences(db);

	return found.map((rule) => toRule(rule, known));
}

/** A rule as the evaluator reads it, beside the snapshot a run keeps of it. */
type Applied = { rule: Rule; snapshot: RuleSnapshot };

/**
 * The rules an application runs: the one `id` names, enabled or not, or every
 * enabled rule in application order. Throws `NOT_FOUND` for an unknown id.
 */
async function rulesToApply(db: Pick<Db, "select">, id: string | undefined): Promise<Applied[]> {
	const found = await readRules(db, id === undefined ? { enabled: true } : { id });

	if (id !== undefined && found.length === 0) {
		throw notFound();
	}

	if (found.length === 0) {
		return [];
	}

	const known = await knownReferences(db);

	return found.map((read) => {
		const { name, conditions, actions } = toData(read);

		return { rule: toRule(read, known), snapshot: { name, conditions, actions } };
	});
}

/**
 * The earliest date any of `reached` reaches, `null` for every date: a rule
 * without a start date reaches them all.
 */
function earliestStart(reached: readonly Rule[]): IsoDate | null {
	const starts = reached.map((rule) => rule.effectiveDate);

	if (starts.includes(null)) {
		return null;
	}

	return starts.filter((start) => start !== null).toSorted()[0] ?? null;
}

/** The plan and per-rule tallies of `applied` over the transactions it reaches. */
async function planOver(db: Pick<Db, "select">, applied: readonly Applied[]) {
	const evaluated = applied.map(({ rule }) => rule);
	const candidates = await ruleCandidates(db, earliestStart(evaluated));

	return planActions(evaluated, candidates, getReportingCurrency(), MAX_TAGS_PER_TRANSACTION);
}

/**
 * How many existing transactions applying the rule `id`, or every enabled
 * rule when it is absent, would change: a locked field or a value already
 * there is no change, and a row several rules change counts once. Writes
 * nothing and records no run.
 */
export async function previewRules(deps: ServiceDeps, id?: string): Promise<{ changed: number }> {
	const applied = await rulesToApply(deps.db, id);

	if (applied.length === 0) {
		return { changed: 0 };
	}

	const { plan } = await planOver(deps.db, applied);

	return { changed: plan.size };
}

export type RuleRunData = {
	id: string;
	/** `null` once the rule is deleted; `rule` still says what ran. */
	ruleId: string | null;
	rule: RuleSnapshot;
	matchedCount: number;
	changedCount: number;
	executedAt: number;
	/** The rule's place in its application, which shares `executedAt`. */
	position: number;
};

/** What an application answers: the rows it changed, and one run per rule. */
export type RuleApplication = { changed: number; runs: RuleRunData[] };

/**
 * Applies the rule `id`, or every enabled rule in application order, to
 * existing transactions, as `previewRules` counted them. One immediate
 * transaction plans again, writes through the ledger with a rule origin, so
 * no lock is added and none is crossed, pairs the rows a transfer action
 * marked, and records one run per rule. No balance moves: no rule action
 * changes an amount. Answers how many rows it changed, a row several rules
 * change counted once, and the runs; none without a rule to apply.
 */
export async function applyRules(deps: ServiceDeps, id?: string): Promise<RuleApplication> {
	return deps.db.transaction(
		async (tx) => {
			const applied = await rulesToApply(tx, id);

			if (applied.length === 0) {
				return { changed: 0, runs: [] };
			}

			const { plan, perRule } = await planOver(tx, applied);
			const now = Date.now();
			// Inside this transaction, the ledger's own becomes a savepoint: the
			// writes and the runs commit together.
			const changed = await applyRulePlanToHistory({ ...deps, db: tx }, plan, {
				origin: "rule",
			});

			const snapshotOf = new Map(applied.map(({ rule, snapshot }) => [rule.id, snapshot]));
			const runs = perRule.map((tally, position) => {
				const snapshot = snapshotOf.get(tally.ruleId);

				// `planActions` tallies the rules it was given, so this is a bug, not a state.
				if (snapshot === undefined) {
					throw new Error("A rule tally names no applied rule.");
				}

				return {
					id: crypto.randomUUID(),
					ruleId: tally.ruleId,
					rule: snapshot,
					matchedCount: tally.matched,
					changedCount: tally.changed,
					executedAt: now,
					position,
				};
			});

			await tx.insert(ruleRuns).values(runs);

			return { changed, runs };
		},
		{ behavior: "immediate" },
	);
}

export type RuleRunPage = {
	items: RuleRunData[];
	page: number;
	pageSize: number;
	total: number;
};

/** A page of the recorded runs, the latest application first, each in the order its rules applied. */
export async function listRuleRuns(
	deps: ServiceDeps,
	page: { page: number; pageSize: number },
): Promise<RuleRunPage> {
	const items = await deps.db
		.select()
		.from(ruleRuns)
		.orderBy(desc(ruleRuns.executedAt), asc(ruleRuns.position), desc(ruleRuns.id))
		.limit(page.pageSize)
		.offset((page.page - 1) * page.pageSize);
	const totals = await deps.db.select({ total: count() }).from(ruleRuns).get();

	return { items, page: page.page, pageSize: page.pageSize, total: totals?.total ?? 0 };
}
