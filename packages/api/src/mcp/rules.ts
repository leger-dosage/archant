import type { ServiceDeps } from "../services/deps.ts";
import type { NameBook } from "../services/names.ts";
import type { RuleApplication } from "../services/rules.ts";

import { z } from "zod";

import { ACTIVITY_LABELS } from "@archant/data/activity-labels";
import type { RuleConditionSnapshot, RuleSnapshot } from "@archant/data/rules";
import {
	RULE_ACTION_TYPES,
	RULE_CONDITION_TYPES,
	RULE_OPERATORS,
	RULE_RUN_EXECUTION_TYPES,
	RULE_RUN_STATUSES,
	tagIdsOf,
} from "@archant/data/rules";

import { AppError } from "../lib/errors.ts";
import { listPageInput } from "../schemas/assistants/fields.ts";
import {
	applyRulesInput,
	previewRuleInput,
	ruleIdInput,
	ruleRunsInput,
	ruleToolInput,
	setRuleEnabledInput,
	updateRuleInput,
} from "../schemas/assistants/rules.ts";
import { namesOf } from "../services/names.ts";
import {
	applyRules,
	createRule,
	deleteRule,
	listRuleRuns,
	listRules,
	previewRules,
	setRuleEnabled,
	updateRule,
} from "../services/rules.ts";
import { transactionsById } from "../services/transactions.ts";
import {
	BANK_TEXT,
	CREATES,
	DESTROYS,
	READ_ONLY,
	REPLACES,
	SETS,
	defineTool,
	pageFieldsOf,
	pageOf,
	pageOutput,
	pluralize,
} from "./tool.ts";
import { itemOf, nameOf, namesFor, transaction } from "./transactions.ts";

const leafOutput = z.object({
	condition_type: z.enum(RULE_CONDITION_TYPES),
	operator: z.enum(RULE_OPERATORS),
	value: z
		.string()
		.nullable()
		.describe(
			'The account, merchant, category or tag by name, an amount as a decimal string such as "12.5", compared in any currency, else the text or type compared; null for is_null and is_not_null.',
		),
});

const conditionOutput = leafOutput.extend({
	value: leafOutput.shape.value.optional().describe("Absent on a group."),
	conditions: z.array(leafOutput).optional().describe("A group's conditions; absent otherwise."),
});

const actionOutput = z.object({
	action_type: z.enum(RULE_ACTION_TYPES),
	value: z
		.string()
		.nullable()
		.describe(
			'The category, merchant or account by name, the tags by name separated by ", ", else the label, the pattern or the investment activity label; null to exclude.',
		),
	replacement: z.string().nullable().optional(),
});

const snapshotFields = {
	name: z.string().nullable(),
	conditions: z.array(conditionOutput),
	actions: z.array(actionOutput),
};

const ruleOutput = z.object({
	id: z.string(),
	enabled: z.boolean(),
	effective_date: z.string().nullable(),
	...snapshotFields,
});

type ConditionOutput = z.input<typeof conditionOutput>;

/** Which of the book's names a condition's or an action's stored id is one of. */
const CONDITION_KINDS: Partial<Record<RuleConditionSnapshot["conditionType"], keyof NameBook>> = {
	transaction_account: "accounts",
	transaction_merchant: "merchants",
	transaction_category: "categories",
	transaction_tag: "tags",
};

const ACTION_KINDS: Partial<Record<RuleSnapshot["actions"][number]["actionType"], keyof NameBook>> =
	{
		set_transaction_category: "categories",
		set_transaction_merchant: "merchants",
		set_transaction_tags: "tags",
		set_as_transfer_or_payment: "accounts",
	};

/** Every id the rules point to, by the kind of row each names. */
function idsIn(rules: readonly RuleSnapshot[]) {
	const ids: Record<keyof NameBook, string[]> = {
		accounts: [],
		categories: [],
		merchants: [],
		tags: [],
	};
	const leaves = rules.flatMap((rule) =>
		rule.conditions.flatMap((condition) => [condition, ...condition.conditions]),
	);

	for (const leaf of leaves) {
		const kind = CONDITION_KINDS[leaf.conditionType];

		if (kind !== undefined && leaf.value !== null) {
			ids[kind].push(leaf.value);
		}
	}

	for (const action of rules.flatMap((rule) => rule.actions)) {
		const kind = ACTION_KINDS[action.actionType];

		if (kind !== undefined && action.value !== null) {
			ids[kind].push(
				...(action.actionType === "set_transaction_tags" ? tagIdsOf(action.value) : [action.value]),
			);
		}
	}

	return ids;
}

/**
 * How a rule read names what it points to, as Sure's `get_transactions`
 * names a transaction's account, category, merchant and tags.
 */
type Reader = { names: NameBook };

async function readerFor(deps: ServiceDeps, rules: readonly RuleSnapshot[]): Promise<Reader> {
	return { names: await namesOf(deps, idsIn(rules)) };
}

/** A stored value as a rule read gives it: a row by its name, else as stored, as Sure's `condition.value`. */
function valueOf(condition: RuleConditionSnapshot, reader: Reader): string | null {
	const { value, conditionType } = condition;
	const kind = CONDITION_KINDS[conditionType];

	if (value === null) {
		return null;
	}

	return kind === undefined ? value : nameOf(reader.names[kind], value);
}

/** A condition, `conditions` on a group only and `value` on a leaf only. */
function conditionOf(condition: RuleConditionSnapshot, reader: Reader): ConditionOutput {
	const { conditionType, operator } = condition;

	if (conditionType !== "compound") {
		return { condition_type: conditionType, operator, value: valueOf(condition, reader) };
	}

	return {
		condition_type: conditionType,
		operator,
		conditions: condition.conditions.map((child) => ({
			condition_type: child.conditionType,
			operator: child.operator,
			value: valueOf(child, reader),
		})),
	};
}

function snapshotOf(rule: RuleSnapshot, reader: Reader) {
	return {
		name: rule.name,
		conditions: rule.conditions.map((condition) => conditionOf(condition, reader)),
		actions: rule.actions.map(({ actionType, value, replacement }) => {
			const kind = ACTION_KINDS[actionType];
			const named =
				kind === undefined || value === null
					? value
					: actionType === "set_transaction_tags"
						? tagIdsOf(value)
								.map((id) => nameOf(reader.names.tags, id))
								.join(", ")
						: nameOf(reader.names[kind], value);

			return {
				action_type: actionType,
				value: named,
				...(replacement === undefined ? {} : { replacement }),
			};
		}),
	};
}

type RuleData = Awaited<ReturnType<typeof listRules>>[number];

function ruleOf(rule: RuleData, reader: Reader) {
	return {
		id: rule.id,
		enabled: rule.enabled,
		effective_date: rule.effectiveDate,
		...snapshotOf(rule, reader),
	};
}

const READS =
	"Each condition and action names the account, merchant, category or tag it points to, and gives an amount as a decimal string that matches a transaction in any currency; create_rule, update_rule and preview_rule take ids and decimal strings instead, from get_accounts, get_merchants, get_categories and get_tags.";

export const getRules = defineTool({
	name: "get_rules",
	title: "Rules",
	description: `Every rule, in the order they apply, a page at a time as Sure's get_categories: a later rule sees what earlier ones set, and overwrites it. Each with its conditions, actions, start date and whether it is enabled. ${READS} ${BANK_TEXT}`,
	scope: "archant:read",
	annotations: READ_ONLY,
	input: listPageInput,
	output: z.object({ rules: z.array(ruleOutput), ...pageOutput }),
	run: async (deps, { page, page_size: pageSize }) => {
		const { items, ...fields } = pageOf(await listRules(deps), page, pageSize);
		const reader = await readerFor(deps, items);

		return {
			result: { rules: items.map((rule) => ruleOf(rule, reader)), ...fields },
			changedRows: 0,
		};
	},
});

/** A run's fields, named as Sure's API names a rule run's. */
const runFields = {
	execution_type: z.enum(RULE_RUN_EXECUTION_TYPES),
	status: z.enum(RULE_RUN_STATUSES),
	transactions_queued: z.number().int(),
	transactions_processed: z.number().int(),
	transactions_modified: z.number().int(),
	error_message: z.string().nullable().describe("The error's code when the run failed."),
};

const runFieldsOf = (run: RuleApplication["runs"][number]) => ({
	execution_type: run.executionType,
	status: run.status,
	transactions_queued: run.transactionsQueued,
	transactions_processed: run.transactionsProcessed,
	transactions_modified: run.transactionsModified,
	error_message: run.errorMessage,
});

/** What `apply_rules` adds to its message when a rule failed, which wrote nothing. */
function failedNote(runs: RuleApplication["runs"]): string {
	const failed = runs.filter((run) => run.status === "failed").length;

	return failed === 0 ? "" : ` ${pluralize(failed, "rule")} failed and changed nothing.`;
}

export const getRuleRuns = defineTool({
	name: "get_rule_runs",
	title: "Rule runs",
	description: `Past runs of rules over existing transactions, the latest first, a page at a time as Sure's get_categories, with the fields of Sure's rule runs: manual when the owner applied the rule, scheduled after a sync or an import; its status; how many transactions it matched (queued), processed and changed (modified); and an error code when it failed. The rule is given as it was then. ${READS} ${BANK_TEXT}`,
	scope: "archant:read",
	annotations: READ_ONLY,
	input: ruleRunsInput,
	output: z.object({
		rule_runs: z.array(
			z.object({
				id: z.string(),
				rule_id: z.string().nullable().describe("null once the rule is deleted."),
				rule: z.object(snapshotFields),
				...runFields,
				executed_at: z.string().describe("When it ran, an ISO 8601 UTC timestamp."),
			}),
		),
		...pageOutput,
	}),
	run: async (deps, { page, page_size: pageSize }) => {
		const runs = await listRuleRuns(deps, { page, pageSize });
		const reader = await readerFor(
			deps,
			runs.items.map((run) => run.rule),
		);

		return {
			result: {
				rule_runs: runs.items.map((run) => ({
					id: run.id,
					rule_id: run.ruleId,
					rule: snapshotOf(run.rule, reader),
					...runFieldsOf(run),
					executed_at: new Date(run.executedAt).toISOString(),
				})),
				...pageFieldsOf(runs.total, runs.page, runs.pageSize),
			},
			changedRows: 0,
		};
	},
});

const change = <Value extends z.ZodType>(value: Value) =>
	z.object({ from: value, to: value }).optional();

/** A draft's field errors under `rule`, where the assistant sent them, in its names. */
async function asDraft<Result>(preview: Promise<Result>): Promise<Result> {
	try {
		return await preview;
	} catch (error) {
		if (error instanceof AppError && error.fields !== undefined) {
			throw new AppError(
				error.code,
				error.message,
				error.fields.map((field) => ({ ...field, path: `rule.${field.path}` })),
				error.params,
			);
		}

		throw error;
	}
}

type Preview = Awaited<ReturnType<typeof previewRules>>;

type Changes = Preview["samples"][number]["changes"];

/** Every id a preview's changes name, beside the ids of the samples' own rows. */
function changedIds(changes: readonly Changes[]) {
	const pairs = <Value>(pick: (item: Changes) => { from: Value; to: Value } | undefined) =>
		changes.flatMap((item) => {
			const pair = pick(item);

			return pair === undefined ? [] : [pair.from, pair.to];
		});

	return {
		accounts: pairs((item) => item.expectedTransferAccount).filter((id) => id !== null),
		categories: pairs((item) => item.category).filter((id) => id !== null),
		merchants: pairs((item) => item.merchant).filter((id) => id !== null),
		tags: pairs((item) => item.tags).flat(),
	};
}

/** A change by name: each side's row named, `null` kept. */
function namedChange(
	pair: { from: string | null; to: string | null } | undefined,
	names: ReadonlyMap<string, string>,
) {
	const named = (id: string | null) => (id === null ? null : nameOf(names, id));

	return pair === undefined ? undefined : { from: named(pair.from), to: named(pair.to) };
}

/** What a preview changes on one row, by name, each field present only when it changes. */
function changesOf(changes: Changes, names: NameBook) {
	const category = namedChange(changes.category, names.categories);
	const merchant = namedChange(changes.merchant, names.merchants);
	const account = namedChange(changes.expectedTransferAccount, names.accounts);
	const tags =
		changes.tags === undefined
			? undefined
			: {
					from: changes.tags.from.map((id) => nameOf(names.tags, id)),
					to: changes.tags.to.map((id) => nameOf(names.tags, id)),
				};

	return {
		...(category === undefined ? {} : { category }),
		...(merchant === undefined ? {} : { merchant }),
		...(tags === undefined ? {} : { tags }),
		...(changes.label === undefined ? {} : { name: changes.label }),
		...(changes.investmentActivityLabel === undefined
			? {}
			: { investment_activity_label: changes.investmentActivityLabel }),
		...(changes.excluded === undefined ? {} : { excluded: changes.excluded }),
		...(account === undefined ? {} : { expected_transfer_account: account }),
	};
}

/** Two books of names as one: the samples' rows' and their changes'. */
function merged(a: NameBook, b: NameBook): NameBook {
	return {
		accounts: new Map([...a.accounts, ...b.accounts]),
		categories: new Map([...a.categories, ...b.categories]),
		merchants: new Map([...a.merchants, ...b.merchants]),
		tags: new Map([...a.tags, ...b.tags]),
	};
}

export const previewRule = defineTool({
	name: "preview_rule",
	title: "Preview a rule",
	description: `What applying rules to existing transactions would do, writing nothing: a saved rule by rule_id, a draft in create_rule's shape as rule, or every rule, disabled ones included, when neither is given. Answers how many transactions match, how many would change, which apply_rules takes as expected_changed, and up to 20 of those, most recent first, each as get_transactions lists it with each changed field's current and new value, by name. A field the owner set by hand, or a value already there, does not change. Show the owner the counts and samples before saving or applying. ${BANK_TEXT}`,
	scope: "archant:read",
	annotations: READ_ONLY,
	input: previewRuleInput,
	output: z.object({
		matched: z.number().int(),
		changed: z.number().int(),
		samples: z.array(
			transaction.omit({ is_transfer: true }).extend({
				changes: z.object({
					category: change(z.string().nullable()),
					merchant: change(z.string().nullable()),
					tags: change(z.array(z.string())),
					name: change(z.string()),
					investment_activity_label: change(z.enum(ACTIVITY_LABELS).nullable()),
					excluded: change(z.boolean()),
					expected_transfer_account: change(z.string().nullable()),
				}),
			}),
		),
	}),
	run: async (deps, input) => {
		const preview = await (input.rule === undefined
			? previewRules(deps, input.rule_id)
			: asDraft(previewRules(deps, input.rule)));
		const changes = new Map(preview.samples.map((sample) => [sample.id, sample.changes]));
		const rows = await transactionsById(
			deps,
			preview.samples.map((sample) => sample.id),
		);
		const names = merged(
			await namesFor(deps, rows),
			await namesOf(deps, changedIds([...changes.values()])),
		);

		return {
			result: {
				matched: preview.matched,
				changed: preview.changed,
				samples: rows.map((row) => {
					const { is_transfer: _transfer, ...item } = itemOf(row, names);

					return { ...item, changes: changesOf(changes.get(row.id) ?? {}, names) };
				}),
			},
			changedRows: 0,
		};
	},
});

/** What a write answers, as Sure's `create_category`: the rule, read as get_rules gives it. */
const savedRule = z.object({ success: z.literal(true), rule: ruleOutput, message: z.string() });

/** Sure's message for a written record: its name quoted when it has one. */
function messageOf(rule: { name: string | null }, verb: string): string {
	return rule.name === null ? `Rule ${verb}.` : `Rule '${rule.name}' ${verb}.`;
}

async function savedOf(deps: ServiceDeps, rule: RuleData, verb: string) {
	return {
		success: true as const,
		rule: ruleOf(rule, await readerFor(deps, [rule])),
		message: messageOf(rule, verb),
	};
}

const WRITES_RULES =
	"The input takes the rule form's shape, with ids and decimal strings; a field the input itself refuses answers { error, hint }, its error each refused field's path and code; a value the rule's check refuses, such as a category that does not exist, answers validation_error, its message naming the field's path and code. Correct it and send again. It answers { success, rule, message }, the rule read as get_rules gives it, by name.";

export const createRuleTool = defineTool({
	name: "create_rule",
	title: "Create a rule",
	description: `Saves a rule, disabled, as one saved in Archant until the owner confirms it: apply_rules with its rule_id enables it and applies it to existing transactions, as « Confirmer les modifications » does, and set_rule_enabled enables it for the run after each sync or import only. Preview it as a draft first. ${WRITES_RULES} ${BANK_TEXT}`,
	scope: "archant:write",
	annotations: CREATES,
	input: ruleToolInput,
	output: savedRule,
	run: async (deps, input) => ({
		result: await savedOf(deps, await createRule(deps, input), "created"),
		changedRows: 1,
	}),
});

export const updateRuleTool = defineTool({
	name: "update_rule",
	title: "Update a rule",
	description: `Replaces a rule's name, start date, conditions and actions; it keeps its place in the order and whether it is enabled. What it wrote before stays. A rule get_rules gives names its rows: give their ids here. ${WRITES_RULES} ${BANK_TEXT}`,
	scope: "archant:write",
	annotations: REPLACES,
	input: updateRuleInput,
	output: savedRule,
	run: async (deps, { ruleId, rule }) => ({
		result: await savedOf(deps, await updateRule(deps, ruleId, rule), "updated"),
		changedRows: 1,
	}),
});

export const setRuleEnabledTool = defineTool({
	name: "set_rule_enabled",
	title: "Enable or disable a rule",
	description: `Turns a rule on or off. Off, it no longer runs after a sync or an import; what it wrote stays. It answers { success, rule, message }. ${BANK_TEXT}`,
	scope: "archant:write",
	annotations: SETS,
	input: setRuleEnabledInput,
	output: savedRule,
	run: async (deps, { rule_id: ruleId, enabled }) => ({
		result: await savedOf(
			deps,
			await setRuleEnabled(deps, ruleId, { enabled }),
			enabled ? "enabled" : "disabled",
		),
		changedRows: 1,
	}),
});

export const deleteRuleTool = defineTool({
	name: "delete_rule",
	title: "Delete a rule",
	description: `Deletes a rule for good. What it wrote on transactions stays. It answers the rule as it was. ${BANK_TEXT}`,
	scope: "archant:write",
	annotations: DESTROYS,
	input: ruleIdInput,
	output: z.object({
		success: z.literal(true),
		deleted: z.literal(true),
		rule: ruleOutput.describe("The rule as it was."),
		message: z.string(),
	}),
	run: async (deps, { rule_id: ruleId }) => {
		const before = (await listRules(deps)).find((rule) => rule.id === ruleId);

		await deleteRule(deps, ruleId);

		// `deleteRule` refused an unknown id: only a rule read just before can reach here.
		if (before === undefined) {
			throw new AppError("NOT_FOUND", "No rule has this id.");
		}

		const { rule, message } = await savedOf(deps, before, "deleted");

		return {
			result: { success: true as const, deleted: true as const, rule, message },
			changedRows: 1,
		};
	},
});

export const applyRulesTool = defineTool({
	name: "apply_rules",
	title: "Apply rules to existing transactions",
	description: `Applies a rule to existing transactions and enables it, as « Confirmer les modifications » does in Archant, or every rule in order, disabled ones included and none enabled, as « Confirmer et appliquer tout », and records each run. Takes the changed count preview_rule gave for the same rule_id: when the transactions to change now number otherwise, it writes nothing and answers rule_preview_stale with the count now; preview again and show the owner. Fields the owner set by hand never change. ${BANK_TEXT}`,
	scope: "archant:write",
	annotations: DESTROYS,
	input: applyRulesInput,
	output: z.object({
		success: z.literal(true),
		changed: z.number().int().describe("Transactions changed, each once."),
		runs: z.array(
			z.object({
				rule_id: z.string().nullable(),
				rule: z.object(snapshotFields).describe("The rule as it ran."),
				...runFields,
			}),
		),
		message: z.string(),
	}),
	run: async (deps, { rule_id: ruleId, expected_changed: expectedChanged }) => {
		const { changed, runs } = await applyRules(deps, ruleId, expectedChanged);
		const reader = await readerFor(
			deps,
			runs.map((run) => run.rule),
		);

		return {
			result: {
				success: true as const,
				changed,
				runs: runs.map((run) => ({
					rule_id: run.ruleId,
					rule: snapshotOf(run.rule, reader),
					...runFieldsOf(run),
				})),
				message: `Applied ${pluralize(runs.length, "rule")}: ${pluralize(changed, "transaction")} changed.${failedNote(runs)}`,
			},
			changedRows: changed,
		};
	},
});
