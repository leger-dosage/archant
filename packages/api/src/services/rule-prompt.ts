import type { ServiceDeps } from "./deps.ts";

import { eq } from "drizzle-orm";

import { users } from "@archant/data/schema/auth";

import { matches } from "../domain/rules/matching.ts";
import { ruleCandidates } from "./ledger/rule-plans.ts";
import { knownReferences, readRules, toRule } from "./rule-reader.ts";

/** How long « Masquer pour aujourd'hui » hides the prompt, Sure's `1.day`. */
const DISMISSED_FOR_MS = 24 * 60 * 60 * 1000;

/**
 * Sure's `Transaction::Ruleable#eligible_for_category_rule?`: the line has a
 * category and no enabled rule that sets this category already matches it.
 * A line of a deactivated account is eligible: rules read active accounts
 * only, as Sure's `matching_resources_scope` reads visible transactions.
 */
async function eligibleForCategoryRule(deps: ServiceDeps, entryId: string): Promise<boolean> {
	const [stored] = await ruleCandidates(deps.db, null, { activeAccountsOnly: false, entryId });

	if (stored === undefined || stored.categoryId === null) {
		return false;
	}

	const [line] = await ruleCandidates(deps.db, null, { activeAccountsOnly: true, entryId });

	if (line === undefined) {
		return true;
	}

	const setting = (await readRules(deps.db, { enabled: true })).filter(({ actions }) =>
		actions.some(
			(action) =>
				action.actionType === "set_transaction_category" && action.value === line.categoryId,
		),
	);

	if (setting.length === 0) {
		return true;
	}

	const known = await knownReferences(deps.db);

	return setting.every((read) => !matches(toRule(read, known), line));
}

/**
 * Sure's `needs_rule_notification?`, once a category was set by hand: the
 * user has not turned the prompt off, nor hidden it in the last 24 hours,
 * and the line is eligible. The caller says the category changed.
 */
export async function offersRulePrompt(
	deps: ServiceDeps,
	userId: string,
	entryId: string,
): Promise<boolean> {
	const user = await deps.db
		.select({
			disabled: users.rulePromptsDisabled,
			dismissedAt: users.rulePromptDismissedAt,
		})
		.from(users)
		.where(eq(users.id, userId))
		.get();

	if (user === undefined || user.disabled) {
		return false;
	}

	if (user.dismissedAt !== null && Date.now() - user.dismissedAt.getTime() < DISMISSED_FOR_MS) {
		return false;
	}

	return eligibleForCategoryRule(deps, entryId);
}

/**
 * Sure's `rule_prompt_settings`, from « Masquer pour aujourd'hui »: hides the
 * prompt for 24 hours from now and, with « Ne plus afficher » ticked, for
 * good; unticked turns it back on, as Sure's form submits both fields.
 */
export async function dismissRulePrompts(
	deps: ServiceDeps,
	userId: string,
	disabled: boolean,
): Promise<{ rulePromptsDisabled: boolean }> {
	await deps.db
		.update(users)
		.set({ rulePromptDismissedAt: new Date(), rulePromptsDisabled: disabled })
		.where(eq(users.id, userId));

	return { rulePromptsDisabled: disabled };
}
