import type { GroupType } from "../domain/categorise-groups.ts";
import type { IsoDate } from "../domain/dates.ts";
import type { CategorizeRequest } from "../schemas/transactions.ts";
import type { ServiceDeps } from "./deps.ts";
import type { RuleData } from "./rules.ts";

import type { MinorUnits } from "@archant/data/money";
import { RULE_NAME_MAX_LENGTH } from "@archant/data/rules";

import { groupTypeOf, groupUncategorised } from "../domain/categorise-groups.ts";
import { squishLabel } from "../domain/normalize-label.ts";
import { AppError } from "../lib/errors.ts";
import { MAX_CATEGORIZE_IDS } from "../schemas/transactions.ts";
import { bulkUpdateTransactions } from "./ledger/edits.ts";
import { countUncategorised, listTransactionsById, uncategorisedLines } from "./ledger/queries.ts";
import { createRule, listRules } from "./rules.ts";

/** A line as the wizard's row shows it. */
export type CategorizeLine = {
	id: string;
	label: string;
	date: IsoDate;
	amount: MinorUnits;
	currency: string;
};

/** The group the wizard shows at a position, with every uncategorised line left. */
export type CategorizeStep = {
	remaining: number;
	group: {
		name: string;
		type: GroupType;
		merchantId: string | null;
		lines: CategorizeLine[];
	} | null;
};

/** The most recent lines first: the rest show at the same position once these are done. */
async function linesOf(deps: ServiceDeps, ids: readonly string[]): Promise<CategorizeLine[]> {
	const rows = await listTransactionsById(deps, ids.slice(0, MAX_CATEGORIZE_IDS));

	return rows.map(({ id, label, date, amount, currency }) => ({
		id,
		label,
		date,
		amount,
		currency,
	}));
}

/**
 * Sure's `Transactions::CategorizesController#show`: the group at `position`
 * among every uncategorised line, `null` past the last one.
 */
export async function categorizeStep(deps: ServiceDeps, position: number): Promise<CategorizeStep> {
	const lines = await uncategorisedLines(deps);
	const group = groupUncategorised(lines)[position];

	return {
		remaining: lines.length,
		group:
			group === undefined
				? null
				: {
						name: group.name,
						type: group.type,
						merchantId: group.merchantId,
						lines: await linesOf(deps, group.ids),
					},
	};
}

/** Sure's `@uncategorized_count`, which « Catégoriser (N) » shows. */
export async function uncategorisedCount(deps: ServiceDeps): Promise<{ remaining: number }> {
	return { remaining: await countUncategorised(deps) };
}

/**
 * Sure's `preview_rule` through `Entry.uncategorized_matching`: the
 * uncategorised lines of the sign whose label contains `filter`, as the
 * rule's « Contient » reads it, none for a blank filter.
 */
export async function previewCategorize(
	deps: ServiceDeps,
	query: { filter: string; type: GroupType },
): Promise<CategorizeLine[]> {
	const wanted = squishLabel(query.filter).toLowerCase();

	if (wanted === "") {
		return [];
	}

	const ids = (await uncategorisedLines(deps))
		.filter(
			(line) =>
				groupTypeOf(line.amount) === query.type &&
				squishLabel(line.label).toLowerCase().includes(wanted),
		)
		.map((line) => line.id);

	return linesOf(deps, ids);
}

const sameParts = (a: Pick<RuleData, "conditions" | "actions">, b: typeof a) =>
	JSON.stringify([a.conditions, a.actions]) === JSON.stringify([b.conditions, b.actions]);

/**
 * Sure's `Rule.create_from_grouping`: an enabled rule named after the
 * filter, « Libellé » « Contient » it, « Type » the sign, setting the
 * category. `false` when it is not created: a rule with the same conditions
 * and actions exists, as Sure's message says, or the rule is invalid.
 */
async function createRuleFromGroup(
	deps: ServiceDeps,
	rule: { name: string; type: GroupType },
	categoryId: string,
): Promise<boolean> {
	const parts = {
		conditions: [
			{ conditionType: "transaction_name", operator: "like", value: rule.name, conditions: [] },
			{ conditionType: "transaction_type", operator: "=", value: rule.type, conditions: [] },
		],
		actions: [{ actionType: "set_transaction_category", value: categoryId }],
	} satisfies Pick<RuleData, "conditions" | "actions">;

	if ((await listRules(deps)).some((existing) => sameParts(existing, parts))) {
		return false;
	}

	try {
		await createRule(deps, {
			...parts,
			name: rule.name.slice(0, RULE_NAME_MAX_LENGTH),
			enabled: true,
		});
	} catch (error) {
		if (error instanceof AppError && error.code === "VALIDATION_ERROR") {
			return false;
		}

		throw error;
	}

	return true;
}

/** What a categorisation did: the lines it set, and the rule asked for, if any. */
export type CategorizeResult = {
	updated: number;
	remaining: number;
	rule: "created" | "failed" | null;
};

/**
 * Sure's `Transactions::CategorizesController#create` and `assign_entry`:
 * the category set on the lines as a hand edit (AD-10), split parents left
 * out, then the rule when asked. The lines stay categorised when the rule
 * is refused.
 */
export async function categorize(
	deps: ServiceDeps,
	request: CategorizeRequest,
): Promise<CategorizeResult> {
	const { matched } = await bulkUpdateTransactions(
		deps,
		{ ids: request.ids },
		{ categoryId: request.categoryId },
		{ origin: "user" },
	);
	const rule =
		request.rule === undefined
			? null
			: (await createRuleFromGroup(deps, request.rule, request.categoryId))
				? "created"
				: "failed";

	return { updated: matched, remaining: await countUncategorised(deps), rule };
}
