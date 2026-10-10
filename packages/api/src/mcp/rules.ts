import { z } from "zod";

import type { CurrencyCode } from "@archant/data/money";
import { toDecimalString, toMinorUnits } from "@archant/data/money";
import type { RuleConditionSnapshot, RuleSnapshot } from "@archant/data/rules";
import { RULE_ACTION_TYPES, RULE_CONDITION_TYPES, RULE_OPERATORS } from "@archant/data/rules";

import { AppError } from "../lib/errors.ts";
import {
	applyRulesInput,
	noToolInput,
	previewRuleInput,
	ruleIdInput,
	ruleRunsInput,
	ruleToolInput,
	setRuleEnabledInput,
	updateRuleInput,
} from "../schemas/assistants.ts";
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
import { getReportingCurrency } from "../services/settings.ts";
import { BANK_TEXT, CREATES, DESTROYS, READ_ONLY, REPLACES, SETS, defineTool } from "./tool.ts";

const leafOutput = z.object({
	condition_type: z.enum(RULE_CONDITION_TYPES),
	operator: z.enum(RULE_OPERATORS),
	value: z.string().nullable(),
});

const conditionOutput = leafOutput.extend({
	value: leafOutput.shape.value.optional().describe("Absent on a group."),
	conditions: z.array(leafOutput).optional().describe("A group's conditions; absent otherwise."),
});

const actionOutput = z.object({
	action_type: z.enum(RULE_ACTION_TYPES),
	value: z.string().nullable(),
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

/**
 * A condition as `create_rule` takes it: an amount as a decimal string, not
 * the minor units it is stored in, and `conditions` on a group only, so a rule
 * read here goes back into `update_rule` as it is.
 */
type ConditionOutput = z.input<typeof conditionOutput>;

/** A stored value as `create_rule` takes it: an amount as a decimal string, not its minor units. */
function valueOf(condition: RuleConditionSnapshot, currency: CurrencyCode): string | null {
	return condition.conditionType === "transaction_amount" && condition.value !== null
		? toDecimalString({ amount: toMinorUnits(Number(condition.value)), currency })
		: condition.value;
}

/**
 * A condition as `create_rule` takes it, `conditions` on a group only and
 * `value` on a leaf only, so a rule read here goes back into `update_rule` as
 * it is.
 */
function conditionOf(condition: RuleConditionSnapshot, currency: CurrencyCode): ConditionOutput {
	const { conditionType, operator } = condition;

	if (conditionType !== "compound") {
		return { condition_type: conditionType, operator, value: valueOf(condition, currency) };
	}

	return {
		condition_type: conditionType,
		operator,
		conditions: condition.conditions.map((child) => ({
			condition_type: child.conditionType,
			operator: child.operator,
			value: valueOf(child, currency),
		})),
	};
}

function snapshotOf(rule: RuleSnapshot, currency: CurrencyCode) {
	return {
		name: rule.name,
		conditions: rule.conditions.map((condition) => conditionOf(condition, currency)),
		actions: rule.actions.map(({ actionType, value, replacement }) => ({
			action_type: actionType,
			value,
			...(replacement === undefined ? {} : { replacement }),
		})),
	};
}

type RuleData = Awaited<ReturnType<typeof listRules>>[number];

function ruleOf(rule: RuleData, currency: CurrencyCode) {
	return {
		id: rule.id,
		enabled: rule.enabled,
		effective_date: rule.effectiveDate,
		...snapshotOf(rule, currency),
	};
}

const AMOUNTS =
	"Amount conditions are decimal strings in the reporting currency, named in currency.";

export const getRules = defineTool({
	name: "get_rules",
	title: "Rules",
	description: `Every rule, in the order they apply: a later rule sees what earlier ones set, and overwrites it. Each with its conditions, actions, start date and whether it is enabled. ${AMOUNTS} ${BANK_TEXT}`,
	scope: "archant:read",
	annotations: READ_ONLY,
	input: noToolInput,
	output: z.object({ currency: z.string(), rules: z.array(ruleOutput) }),
	run: async (deps) => {
		const currency = getReportingCurrency();
		const rules = await listRules(deps);

		return {
			result: { currency, rules: rules.map((rule) => ruleOf(rule, currency)) },
			changedRows: 0,
		};
	},
});

export const getRuleRuns = defineTool({
	name: "get_rule_runs",
	title: "Rule runs",
	description: `A page of past applications of rules to existing transactions, the latest first: the rule as it was then, how many transactions it matched and how many it changed. ${AMOUNTS} ${BANK_TEXT}`,
	scope: "archant:read",
	annotations: READ_ONLY,
	input: ruleRunsInput,
	output: z.object({
		currency: z.string(),
		items: z.array(
			z.object({
				id: z.string(),
				rule_id: z.string().nullable().describe("null once the rule is deleted."),
				rule: z.object(snapshotFields),
				matched_count: z.number().int(),
				changed_count: z.number().int(),
				executed_at: z.string().describe("When it ran, an ISO 8601 UTC timestamp."),
			}),
		),
		page: z.number().int(),
		page_size: z.number().int(),
		total_results: z.number().int(),
	}),
	run: async (deps, input) => {
		const currency = getReportingCurrency();
		const runs = await listRuleRuns(deps, { page: input.page, pageSize: input.page_size });

		return {
			result: {
				currency,
				items: runs.items.map((run) => ({
					id: run.id,
					rule_id: run.ruleId,
					rule: snapshotOf(run.rule, currency),
					matched_count: run.matchedCount,
					changed_count: run.changedCount,
					executed_at: new Date(run.executedAt).toISOString(),
				})),
				page: runs.page,
				page_size: runs.pageSize,
				total_results: runs.total,
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

export const previewRule = defineTool({
	name: "preview_rule",
	title: "Preview a rule",
	description: `What applying rules to existing transactions would do, writing nothing: a saved rule by rule_id, a draft in create_rule's shape as rule, or every enabled rule when neither is given. Answers how many transactions match, how many would change, which apply_rules takes as expected_changed, and up to 20 of those, most recent first, each changed field with its current and new value. A field the owner set by hand, or a value already there, does not change. Show the owner the counts and samples before saving or applying. ${BANK_TEXT}`,
	scope: "archant:read",
	annotations: READ_ONLY,
	input: previewRuleInput,
	output: z.object({
		matched: z.number().int(),
		changed: z.number().int(),
		samples: z.array(
			z.object({
				id: z.string(),
				date: z.string(),
				name: z.string().describe("The label as it stands."),
				amount: z.string().describe('A decimal string such as "-12.50" in the currency beside it.'),
				currency: z.string(),
				account_id: z.string(),
				changes: z.object({
					category: change(z.string().nullable()),
					merchant: change(z.string().nullable()),
					tags: change(z.array(z.string())),
					name: change(z.string()),
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

		return {
			result: {
				matched: preview.matched,
				changed: preview.changed,
				samples: preview.samples.map((sample) => ({
					id: sample.id,
					date: sample.date,
					name: sample.label,
					amount: toDecimalString(sample),
					currency: sample.currency,
					account_id: sample.accountId,
					changes: {
						...(sample.changes.category === undefined ? {} : { category: sample.changes.category }),
						...(sample.changes.merchant === undefined ? {} : { merchant: sample.changes.merchant }),
						...(sample.changes.tags === undefined ? {} : { tags: sample.changes.tags }),
						...(sample.changes.label === undefined ? {} : { name: sample.changes.label }),
						...(sample.changes.excluded === undefined ? {} : { excluded: sample.changes.excluded }),
						...(sample.changes.expectedTransferAccount === undefined
							? {}
							: { expected_transfer_account: sample.changes.expectedTransferAccount }),
					},
				})),
			},
			changedRows: 0,
		};
	},
});

const savedRule = z.object({ currency: z.string(), rule: ruleOutput });

const WRITES_RULES =
	"The input takes the rule form's shape; a field the input itself refuses answers { error, hint }, its error each refused field's path and code; a value the rule's check refuses, such as a category that does not exist, answers validation_error, its message naming the field's path and code. Correct it and send again.";

export const createRuleTool = defineTool({
	name: "create_rule",
	title: "Create a rule",
	description: `Saves a rule, enabled at once: it applies to every new transaction from then on, as one saved in Archant does, and to existing ones only through apply_rules. Preview it as a draft first. ${WRITES_RULES} ${BANK_TEXT}`,
	scope: "archant:write",
	annotations: CREATES,
	input: ruleToolInput,
	output: savedRule,
	run: async (deps, input) => {
		const currency = getReportingCurrency();

		return {
			result: { currency, rule: ruleOf(await createRule(deps, input), currency) },
			changedRows: 1,
		};
	},
});

export const updateRuleTool = defineTool({
	name: "update_rule",
	title: "Update a rule",
	description: `Replaces a rule's name, start date, conditions and actions; it keeps its place in the order and whether it is enabled. What it wrote before stays. ${WRITES_RULES} ${BANK_TEXT}`,
	scope: "archant:write",
	annotations: REPLACES,
	input: updateRuleInput,
	output: savedRule,
	run: async (deps, { ruleId, rule }) => {
		const currency = getReportingCurrency();

		return {
			result: { currency, rule: ruleOf(await updateRule(deps, ruleId, rule), currency) },
			changedRows: 1,
		};
	},
});

export const setRuleEnabledTool = defineTool({
	name: "set_rule_enabled",
	title: "Enable or disable a rule",
	description: `Turns a rule on or off. Off, it no longer applies to new transactions; what it wrote stays. ${BANK_TEXT}`,
	scope: "archant:write",
	annotations: SETS,
	input: setRuleEnabledInput,
	output: savedRule,
	run: async (deps, { rule_id: ruleId, enabled }) => {
		const currency = getReportingCurrency();

		return {
			result: { currency, rule: ruleOf(await setRuleEnabled(deps, ruleId, { enabled }), currency) },
			changedRows: 1,
		};
	},
});

export const deleteRuleTool = defineTool({
	name: "delete_rule",
	title: "Delete a rule",
	description: "Deletes a rule for good. What it wrote on transactions stays.",
	scope: "archant:write",
	annotations: DESTROYS,
	input: ruleIdInput,
	output: z.object({ id: z.string() }),
	run: async (deps, { rule_id: ruleId }) => ({
		result: await deleteRule(deps, ruleId),
		changedRows: 1,
	}),
});

export const applyRulesTool = defineTool({
	name: "apply_rules",
	title: "Apply rules to existing transactions",
	description:
		"Applies a rule, enabled or not, or every enabled rule in order, to existing transactions, as « Appliquer » does in Archant, and records each run. Takes the changed count preview_rule gave for the same rule_id: when the transactions to change now number otherwise, it writes nothing and answers rule_preview_stale with the count now; preview again and show the owner. Fields the owner set by hand never change.",
	scope: "archant:write",
	annotations: DESTROYS,
	input: applyRulesInput,
	output: z.object({
		changed: z.number().int().describe("Transactions changed, each once."),
		runs: z.array(
			z.object({
				rule_id: z.string().nullable(),
				matched_count: z.number().int(),
				changed_count: z.number().int(),
			}),
		),
	}),
	run: async (deps, { rule_id: ruleId, expected_changed: expectedChanged }) => {
		const { changed, runs } = await applyRules(deps, ruleId, expectedChanged);

		return {
			result: {
				changed,
				runs: runs.map((run) => ({
					rule_id: run.ruleId,
					matched_count: run.matchedCount,
					changed_count: run.changedCount,
				})),
			},
			changedRows: changed,
		};
	},
});
