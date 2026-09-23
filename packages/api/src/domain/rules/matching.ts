import type { IsoDate } from "../dates.ts";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import type { RuleOperatorOf } from "@archant/data/rules";

import { squishLabel } from "../normalize-label.ts";

/**
 * `like` contains, case aside; `=` is the whole label, case included. Accents
 * count either way, as with Sure's `ILIKE`.
 */
export type LabelCondition = {
	type: "transaction_name";
	operator: RuleOperatorOf<"transaction_name">;
	value: string;
};

/** Compared with the transaction's absolute amount, in the reporting currency only. */
export type AmountCondition = {
	type: "transaction_amount";
	operator: RuleOperatorOf<"transaction_amount">;
	value: MinorUnits;
};

/** `accountId` is `null` once the account is deleted: the condition then matches nothing. */
export type AccountCondition = {
	type: "transaction_account";
	operator: RuleOperatorOf<"transaction_account">;
	accountId: string | null;
};

export type LeafCondition = LabelCondition | AmountCondition | AccountCondition;

/** One level deep: `and` matches on all of its conditions, `or` on any. */
export type GroupCondition = {
	type: "compound";
	operator: RuleOperatorOf<"compound">;
	conditions: LeafCondition[];
};

export type Condition = LeafCondition | GroupCondition;

/** `categoryId` is `null` once the category is deleted: the action then writes nothing. */
export type CategoryAction = { type: "set_transaction_category"; categoryId: string | null };

export type RuleAction = CategoryAction;

/** An enabled rule as the evaluator reads it, its references already resolved. */
export type Rule = {
	id: string;
	effectiveDate: IsoDate | null;
	conditions: Condition[];
	actions: RuleAction[];
};

/** What a condition reads of a transaction. */
export type RuleCandidate = {
	id: string;
	accountId: string;
	date: IsoDate;
	amount: MinorUnits;
	currency: string;
	label: string;
};

function labelMatches(condition: LabelCondition, label: string): boolean {
	const value = squishLabel(condition.value);
	const text = squishLabel(label);

	// Sure's `ILIKE` folds case beyond ASCII, which SQLite's `LIKE` does not:
	// this is why rules are evaluated here rather than in SQL.
	return condition.operator === "like"
		? text.toLowerCase().includes(value.toLowerCase())
		: text === value;
}

const COMPARE: Record<
	AmountCondition["operator"],
	(amount: MinorUnits, value: MinorUnits) => boolean
> = {
	"=": (amount, value) => amount === value,
	">": (amount, value) => amount > value,
	">=": (amount, value) => amount >= value,
	"<": (amount, value) => amount < value,
	"<=": (amount, value) => amount <= value,
	"!=": (amount, value) => amount !== value,
};

function amountMatches(
	condition: AmountCondition,
	candidate: RuleCandidate,
	reportingCurrency: string,
): boolean {
	// Minor units mean different amounts across currencies, and there are no
	// exchange rates (AD-6): another currency never matches.
	if (candidate.currency !== reportingCurrency) {
		return false;
	}

	return COMPARE[condition.operator](toMinorUnits(Math.abs(candidate.amount)), condition.value);
}

function accountMatches(condition: AccountCondition, accountId: string): boolean {
	if (condition.accountId === null) {
		return false;
	}

	return accountId === condition.accountId;
}

function leafMatches(
	condition: LeafCondition,
	candidate: RuleCandidate,
	reportingCurrency: string,
): boolean {
	if (condition.type === "transaction_name") {
		return labelMatches(condition, candidate.label);
	}

	if (condition.type === "transaction_amount") {
		return amountMatches(condition, candidate, reportingCurrency);
	}

	return accountMatches(condition, candidate.accountId);
}

function conditionMatches(
	condition: Condition,
	candidate: RuleCandidate,
	reportingCurrency: string,
): boolean {
	if (condition.type !== "compound") {
		return leafMatches(condition, candidate, reportingCurrency);
	}

	// An empty group matches everything, as in Sure.
	if (condition.conditions.length === 0) {
		return true;
	}

	const holds = (leaf: LeafCondition) => leafMatches(leaf, candidate, reportingCurrency);

	return condition.operator === "and"
		? condition.conditions.every(holds)
		: condition.conditions.some(holds);
}

/**
 * Whether `rule` reaches `candidate`: dated on or after its start date, and
 * every top-level condition holding. A rule without conditions matches every
 * transaction, as in Sure.
 */
export function matches(rule: Rule, candidate: RuleCandidate, reportingCurrency: string): boolean {
	if (rule.effectiveDate !== null && candidate.date < rule.effectiveDate) {
		return false;
	}

	return rule.conditions.every((condition) =>
		conditionMatches(condition, candidate, reportingCurrency),
	);
}

/**
 * The category each candidate ends up with, by entry id: `rules` apply in the
 * order given, creation order, and each matching rule overwrites what an
 * earlier one planned. A candidate no rule categorises is absent. A deleted
 * category plans nothing, so it leaves an earlier rule's choice in place.
 */
export function planCategories(
	rules: readonly Rule[],
	candidates: readonly RuleCandidate[],
	reportingCurrency: string,
): Map<string, string> {
	const planned = new Map<string, string>();

	for (const candidate of candidates) {
		for (const rule of rules) {
			if (matches(rule, candidate, reportingCurrency)) {
				for (const action of rule.actions) {
					if (action.categoryId !== null) {
						planned.set(candidate.id, action.categoryId);
					}
				}
			}
		}
	}

	return planned;
}
