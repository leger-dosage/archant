import type { Direction } from "../cash-flow.ts";
import type { IsoDate } from "../dates.ts";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import type { RuleOperatorOf } from "@archant/data/rules";
import type { LockableField } from "@archant/data/schema/transactions";
import type { TransferKind } from "@archant/data/transfer-kinds";

import { direction } from "../cash-flow.ts";
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

/**
 * A merchant, a category or a tag. `=` compares with `id`, which is `null`
 * once that row is deleted: the condition then matches nothing. `is_null`
 * reads no id. A category is that category only, never one of its children,
 * and a tag is one the row carries among others, as in Sure.
 */
type ReferenceType = "transaction_merchant" | "transaction_category" | "transaction_tag";

export type ReferenceCondition = {
	type: ReferenceType;
	operator: RuleOperatorOf<ReferenceType>;
	id: string | null;
};

/** Compared as the label is; `is_null` matches a row without notes. */
export type NotesCondition =
	| { type: "transaction_notes"; operator: "is_null" }
	| {
			type: "transaction_notes";
			operator: Exclude<RuleOperatorOf<"transaction_notes">, "is_null">;
			value: string;
	  };

/** The row's `direction`, the rule the list's type filter uses. */
export type TypeCondition = {
	type: "transaction_type";
	operator: RuleOperatorOf<"transaction_type">;
	value: Direction;
};

export type LeafCondition =
	| LabelCondition
	| AmountCondition
	| AccountCondition
	| ReferenceCondition
	| NotesCondition
	| TypeCondition;

/** One level deep: `and` matches on all of its conditions, `or` on any. */
export type GroupCondition = {
	type: "compound";
	operator: RuleOperatorOf<"compound">;
	conditions: LeafCondition[];
};

export type Condition = LeafCondition | GroupCondition;

/*
 * An id is `null` once the row it named is deleted: the action then writes
 * nothing, as in Sure.
 */
export type CategoryAction = { type: "set_transaction_category"; categoryId: string | null };

export type MerchantAction = { type: "set_transaction_merchant"; merchantId: string | null };

/** Adds one tag and keeps the others; Sure's `set_transaction_tags` adds several at once. */
export type TagAction = { type: "set_transaction_tags"; tagId: string | null };

export type RenameAction = { type: "set_transaction_name"; label: string };

export type ExcludeAction = { type: "exclude_transaction" };

/**
 * Records the account the other side of a transfer is expected in; the
 * transfer matcher reads it. It never creates an entry or a transfer.
 */
export type TransferAction = { type: "set_as_transfer_or_payment"; accountId: string | null };

export type RuleAction =
	| CategoryAction
	| MerchantAction
	| TagAction
	| RenameAction
	| ExcludeAction
	| TransferAction;

/** An enabled rule as the evaluator reads it, its references already resolved. */
export type Rule = {
	id: string;
	effectiveDate: IsoDate | null;
	conditions: Condition[];
	actions: RuleAction[];
};

/** What a condition reads of a transaction, and what an action may change. */
export type RuleCandidate = {
	id: string;
	accountId: string;
	date: IsoDate;
	amount: MinorUnits;
	currency: string;
	label: string;
	notes: string | null;
	merchantId: string | null;
	categoryId: string | null;
	tagIds: readonly string[];
	excluded: boolean;
	/** The transfer the row is a side of: `direction` needs its kind. */
	transfer: { kind: TransferKind } | null;
	expectedTransferAccountId: string | null;
	lockedFields: readonly LockableField[];
};

function textMatches(operator: "like" | "=", expected: string, actual: string): boolean {
	const value = squishLabel(expected);
	const text = squishLabel(actual);

	// Sure's `ILIKE` folds case beyond ASCII, which SQLite's `LIKE` does not:
	// this is why rules are evaluated here rather than in SQL.
	return operator === "like" ? text.toLowerCase().includes(value.toLowerCase()) : text === value;
}

function notesMatch(condition: NotesCondition, notes: string | null): boolean {
	if (condition.operator === "is_null") {
		return notes === null;
	}

	return notes !== null && textMatches(condition.operator, condition.value, notes);
}

function referenceMatches(condition: ReferenceCondition, row: RuleCandidate): boolean {
	if (condition.type === "transaction_tag") {
		return condition.operator === "is_null"
			? row.tagIds.length === 0
			: condition.id !== null && row.tagIds.includes(condition.id);
	}

	const current = condition.type === "transaction_merchant" ? row.merchantId : row.categoryId;

	return condition.operator === "is_null"
		? current === null
		: condition.id !== null && current === condition.id;
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
	row: RuleCandidate,
	reportingCurrency: string,
): boolean {
	switch (condition.type) {
		case "transaction_name":
			return textMatches(condition.operator, condition.value, row.label);
		case "transaction_amount":
			return amountMatches(condition, row, reportingCurrency);
		case "transaction_account":
			return accountMatches(condition, row.accountId);
		case "transaction_notes":
			return notesMatch(condition, row.notes);
		case "transaction_type":
			return direction(row) === condition.value;
		default:
			return referenceMatches(condition, row);
	}
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
 * What rules change on one row, only where the value differs from the row's:
 * the category, the merchant, the tags to add, the label, the exclusion and
 * the expected counterpart account.
 */
export type RowPlan = {
	categoryId?: string;
	merchantId?: string;
	addTagIds?: string[];
	label?: string;
	excluded?: true;
	expectedTransferAccountId?: string;
};

/** The fields one action changes on `row`, none when it is inert there. */
function applyAction(
	action: RuleAction,
	row: RuleCandidate,
	maxTagsPerRow: number,
): Partial<RuleCandidate> {
	const locked = (field: LockableField) => row.lockedFields.includes(field);

	switch (action.type) {
		case "set_transaction_category":
			return action.categoryId === null || locked("category")
				? {}
				: { categoryId: action.categoryId };
		case "set_transaction_merchant":
			return action.merchantId === null || locked("merchant")
				? {}
				: { merchantId: action.merchantId };
		case "set_transaction_tags":
			return action.tagId === null ||
				locked("tags") ||
				row.tagIds.includes(action.tagId) ||
				row.tagIds.length >= maxTagsPerRow
				? {}
				: { tagIds: [...row.tagIds, action.tagId] };
		case "set_transaction_name":
			return locked("label") ? {} : { label: action.label };
		case "exclude_transaction":
			return locked("excluded") ? {} : { excluded: true };
		default:
			// A row already in a transfer has found its other side; its own
			// account can never hold it, and expecting it there would block
			// every match of the row.
			return action.accountId === null ||
				row.transfer !== null ||
				action.accountId === row.accountId
				? {}
				: { expectedTransferAccountId: action.accountId };
	}
}

function planOf(candidate: RuleCandidate, row: RuleCandidate): RowPlan {
	const added = row.tagIds.filter((id) => !candidate.tagIds.includes(id));

	return {
		...(row.categoryId !== null && row.categoryId !== candidate.categoryId
			? { categoryId: row.categoryId }
			: {}),
		...(row.merchantId !== null && row.merchantId !== candidate.merchantId
			? { merchantId: row.merchantId }
			: {}),
		...(added.length > 0 ? { addTagIds: added } : {}),
		...(row.label !== candidate.label ? { label: row.label } : {}),
		...(row.excluded && !candidate.excluded ? { excluded: true as const } : {}),
		...(row.expectedTransferAccountId !== null &&
		row.expectedTransferAccountId !== candidate.expectedTransferAccountId
			? { expectedTransferAccountId: row.expectedTransferAccountId }
			: {}),
	};
}

/** What one rule did over the candidates, for its run. */
export type RuleTally = {
	ruleId: string;
	/** Rows it matched, against the state earlier rules planned. */
	matched: number;
	/** Rows its actions altered: a locked field or a value already there is no change. */
	changed: number;
};

/**
 * What rules change on each candidate, by entry id, and what each rule did.
 * `rules` apply in the order given, creation order, over one planned state
 * per row: a later rule's conditions see what earlier ones planned, and its
 * actions overwrite them. An action on a locked field, or naming a deleted
 * row, plans nothing, so later rules see the value unchanged. A tag past
 * `maxTagsPerRow` is skipped. A candidate no rule changes is absent from
 * `plan`; `perRule` holds one tally per rule, in the same order.
 */
export function planActions(
	rules: readonly Rule[],
	candidates: readonly RuleCandidate[],
	reportingCurrency: string,
	maxTagsPerRow: number,
): { plan: Map<string, RowPlan>; perRule: RuleTally[] } {
	const plan = new Map<string, RowPlan>();
	const tallied = rules.map((rule) => ({
		rule,
		tally: { ruleId: rule.id, matched: 0, changed: 0 },
	}));

	for (const candidate of candidates) {
		// The row as later rules see it: what earlier ones planned over the row as it is.
		let row = candidate;

		for (const { rule, tally } of tallied) {
			if (matches(rule, row, reportingCurrency)) {
				const before = row;

				for (const action of rule.actions) {
					row = { ...row, ...applyAction(action, row, maxTagsPerRow) };
				}

				tally.matched += 1;
				tally.changed += Object.keys(planOf(before, row)).length > 0 ? 1 : 0;
			}
		}

		const planned = planOf(candidate, row);

		if (Object.keys(planned).length > 0) {
			plan.set(candidate.id, planned);
		}
	}

	return { plan, perRule: tallied.map(({ tally }) => tally) };
}
