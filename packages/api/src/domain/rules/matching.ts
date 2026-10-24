import type { Direction } from "../cash-flow.ts";
import type { IsoDate } from "../dates.ts";
import type { LabelPattern } from "./label-pattern.ts";

import type { Decimal, MinorUnits } from "@archant/data/money";
import { compareWithDecimal, toMinorUnits } from "@archant/data/money";
import type { RuleOperatorOf, ValuelessRuleOperator } from "@archant/data/rules";
import type {
	LockableField,
	LockedFields,
	TransactionExtra,
} from "@archant/data/schema/transactions";
import type { TransferKind } from "@archant/data/transfer-kinds";

import { direction } from "../cash-flow.ts";
import { squishLabel } from "../normalize-label.ts";
import { replaceInLabel } from "./label-pattern.ts";

/**
 * The label or the notes, as Sure's text conditions. `like` contains, case
 * aside; `=` is the whole text, case included. Accents count either way, as
 * with Sure's `ILIKE`. `not_like` and `!=` also match an empty field, as
 * Sure's `OR field IS NULL` and `IS DISTINCT FROM`; a label is never empty.
 */
type TextType = "transaction_name" | "transaction_notes";

type TextCondition =
	| { type: TextType; operator: ValuelessRuleOperator }
	| {
			type: TextType;
			operator: Exclude<RuleOperatorOf<TextType>, ValuelessRuleOperator>;
			value: string;
	  };

/**
 * Compared with the transaction's absolute amount whatever its currency, as
 * Sure's `ABS(entries.amount)` with `value.to_d`: 50 is 50 € as much as 50 ¥.
 */
type AmountCondition = {
	type: "transaction_amount";
	operator: RuleOperatorOf<"transaction_amount">;
	value: Decimal;
};

/**
 * An account, a merchant, a category or a tag. `id` is `null` once that row
 * is deleted: `=` then matches nothing and `!=` everything, since no row
 * holds it, as in Sure. A valueless operator reads no id. A category is that
 * category only, never one of its children, and a tag is one the row carries
 * among others, as in Sure. An account is never empty.
 */
type ReferenceType = "transaction_account" | "transaction_merchant" | "transaction_category";

type ReferenceCondition =
	| { type: ReferenceType; operator: RuleOperatorOf<ReferenceType>; id: string | null }
	| { type: "transaction_tag"; operator: RuleOperatorOf<"transaction_tag">; id: string | null };

/**
 * The bank's details, as Sure's `TransactionDetails`: `like` finds the value
 * in any string or number at any depth, case aside, and `=` the same with
 * case, as Sure's `ILIKE` and `LIKE '%value%'`; neither reads a key or a
 * boolean. `is_null` matches a row without details.
 */
type DetailsCondition =
	| { type: "transaction_details"; operator: "is_null" }
	| { type: "transaction_details"; operator: "like" | "="; value: string };

/** The row's `direction`, the rule the list's type filter uses. */
type TypeCondition = {
	type: "transaction_type";
	operator: RuleOperatorOf<"transaction_type">;
	value: Direction;
};

export type LeafCondition =
	| TextCondition
	| AmountCondition
	| ReferenceCondition
	| DetailsCondition
	| TypeCondition;

/** One level deep: `and` matches on all of its conditions, `or` on any. */
type GroupCondition = {
	type: "compound";
	operator: RuleOperatorOf<"compound">;
	conditions: LeafCondition[];
};

export type Condition = LeafCondition | GroupCondition;

/*
 * An id is `null` once the row it named is deleted: the action then writes
 * nothing, as in Sure.
 */
type CategoryAction = { type: "set_transaction_category"; categoryId: string | null };

type MerchantAction = { type: "set_transaction_merchant"; merchantId: string | null };

/**
 * Adds every tag the row lacks and keeps the others, as Sure's
 * `set_transaction_tags`; deleted tags are already left out, so an empty list
 * writes nothing.
 */
type TagAction = { type: "set_transaction_tags"; tagIds: readonly string[] };

type RenameAction = { type: "set_transaction_name"; label: string };

/** The pattern is compiled once, when the rules are read, never per transaction. */
type ReplaceAction = {
	type: "replace_in_transaction_name";
	pattern: LabelPattern;
	replacement: string;
};

type ExcludeAction = { type: "exclude_transaction" };

/**
 * Records the account the other side of a transfer is expected in; the
 * transfer matcher reads it. It never creates an entry or a transfer.
 */
type TransferAction = { type: "set_as_transfer_or_payment"; accountId: string | null };

export type RuleAction =
	| CategoryAction
	| MerchantAction
	| TagAction
	| RenameAction
	| ReplaceAction
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
	/** What the bank sent beside the line; `null` for a line no bank sent. */
	extra: TransactionExtra | null;
	merchantId: string | null;
	categoryId: string | null;
	tagIds: readonly string[];
	excluded: boolean;
	/** The transfer the row is a side of: `direction` needs its kind. */
	transfer: { kind: TransferKind } | null;
	expectedTransferAccountId: string | null;
	lockedFields: LockedFields;
};

function textMatches(condition: TextCondition, field: string | null): boolean {
	switch (condition.operator) {
		case "is_null":
			return field === null;
		case "is_not_null":
			return field !== null;
		case "not_like":
			return field === null || !textMatches({ ...condition, operator: "like" }, field);
		case "!=":
			return field === null || !textMatches({ ...condition, operator: "=" }, field);
		default: {
			if (field === null) {
				return false;
			}

			const value = squishLabel(condition.value);
			const text = squishLabel(field);

			// Sure's `ILIKE` folds case beyond ASCII, which SQLite's `LIKE` does not:
			// this is why rules are evaluated here rather than in SQL.
			return condition.operator === "like"
				? text.toLowerCase().includes(value.toLowerCase())
				: text === value;
		}
	}
}

/**
 * The string and number values of `node` at any depth, as Sure's
 * `jsonb_path_query(extra, 'strict $.**')` kept to `string` and `number`.
 */
function* searchedValues(node: unknown): Generator<string> {
	if (typeof node === "string") {
		yield node;
	} else if (typeof node === "number") {
		yield String(node);
	} else if (typeof node === "object" && node !== null) {
		for (const child of Object.values(node)) {
			yield* searchedValues(child);
		}
	}
}

function detailsMatch(condition: DetailsCondition, extra: TransactionExtra | null): boolean {
	if (condition.operator === "is_null") {
		return extra === null || Object.keys(extra).length === 0;
	}

	const { value } = condition;
	const wanted = condition.operator === "like" ? value.toLowerCase() : value;

	for (const text of searchedValues(extra)) {
		if ((condition.operator === "like" ? text.toLowerCase() : text).includes(wanted)) {
			return true;
		}
	}

	return false;
}

/** What a reference condition reads of the row: tags apart, since a row carries several. */
function referenceOf(type: ReferenceType, row: RuleCandidate) {
	switch (type) {
		case "transaction_account":
			return row.accountId;
		case "transaction_merchant":
			return row.merchantId;
		default:
			return row.categoryId;
	}
}

function referenceMatches(condition: ReferenceCondition, row: RuleCandidate): boolean {
	if (condition.type === "transaction_tag") {
		return condition.operator === "is_null"
			? row.tagIds.length === 0
			: condition.id !== null && row.tagIds.includes(condition.id);
	}

	const current = referenceOf(condition.type, row);

	switch (condition.operator) {
		case "is_null":
			return current === null;
		case "is_not_null":
			return current !== null;
		case "!=":
			return condition.id === null || current !== condition.id;
		default:
			return condition.id !== null && current === condition.id;
	}
}

/** Each operator on the sign of the amount compared with the value. */
const COMPARE: Record<AmountCondition["operator"], (order: number) => boolean> = {
	"=": (order) => order === 0,
	">": (order) => order > 0,
	">=": (order) => order >= 0,
	"<": (order) => order < 0,
	"<=": (order) => order <= 0,
	"!=": (order) => order !== 0,
};

function amountMatches(condition: AmountCondition, candidate: RuleCandidate): boolean {
	const amount = toMinorUnits(Math.abs(candidate.amount));

	return COMPARE[condition.operator](
		compareWithDecimal({ amount, currency: candidate.currency }, condition.value),
	);
}

function leafMatches(condition: LeafCondition, row: RuleCandidate): boolean {
	switch (condition.type) {
		case "transaction_name":
			return textMatches(condition, row.label);
		case "transaction_notes":
			return textMatches(condition, row.notes);
		case "transaction_amount":
			return amountMatches(condition, row);
		case "transaction_details":
			return detailsMatch(condition, row.extra);
		case "transaction_type":
			return direction(row) === condition.value;
		default:
			return referenceMatches(condition, row);
	}
}

function conditionMatches(condition: Condition, candidate: RuleCandidate): boolean {
	if (condition.type !== "compound") {
		return leafMatches(condition, candidate);
	}

	// An empty group matches everything, as in Sure.
	if (condition.conditions.length === 0) {
		return true;
	}

	const holds = (leaf: LeafCondition) => leafMatches(leaf, candidate);

	return condition.operator === "and"
		? condition.conditions.every(holds)
		: condition.conditions.some(holds);
}

/**
 * Whether `rule` reaches `candidate`: dated on or after its start date, and
 * every top-level condition holding. A rule without conditions matches every
 * transaction, as in Sure.
 */
export function matches(rule: Rule, candidate: RuleCandidate): boolean {
	if (rule.effectiveDate !== null && candidate.date < rule.effectiveDate) {
		return false;
	}

	return rule.conditions.every((condition) => conditionMatches(condition, candidate));
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
	const locked = (field: LockableField) => Object.hasOwn(row.lockedFields, field);

	switch (action.type) {
		case "set_transaction_category":
			return action.categoryId === null || locked("category")
				? {}
				: { categoryId: action.categoryId };
		case "set_transaction_merchant":
			return action.merchantId === null || locked("merchant")
				? {}
				: { merchantId: action.merchantId };
		case "set_transaction_tags": {
			if (locked("tags")) {
				return {};
			}

			// Past the cap a tag is skipped, as a transaction holds no more.
			const added = action.tagIds
				.filter((tagId) => !row.tagIds.includes(tagId))
				.slice(0, Math.max(0, maxTagsPerRow - row.tagIds.length));

			return added.length === 0 ? {} : { tagIds: [...row.tagIds, ...added] };
		}
		case "set_transaction_name":
			return locked("label") ? {} : { label: action.label };
		case "replace_in_transaction_name":
			return locked("label")
				? {}
				: { label: replaceInLabel(action.pattern, action.replacement, row.label) };
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
 * `plan`; `perRule` holds one tally per rule, in the same order; `matched`
 * counts the candidates any rule matched, each once, changed or not.
 */
export function planActions(
	rules: readonly Rule[],
	candidates: readonly RuleCandidate[],
	maxTagsPerRow: number,
): { plan: Map<string, RowPlan>; perRule: RuleTally[]; matched: number } {
	const plan = new Map<string, RowPlan>();
	let matched = 0;
	const tallied = rules.map((rule) => ({
		rule,
		tally: { ruleId: rule.id, matched: 0, changed: 0 },
	}));

	for (const candidate of candidates) {
		// The row as later rules see it: what earlier ones planned over the row as it is.
		let row = candidate;
		let reached = false;

		for (const { rule, tally } of tallied) {
			if (matches(rule, row)) {
				const before = row;
				reached = true;

				for (const action of rule.actions) {
					row = { ...row, ...applyAction(action, row, maxTagsPerRow) };
				}

				tally.matched += 1;
				tally.changed += Object.keys(planOf(before, row)).length > 0 ? 1 : 0;
			}
		}

		matched += reached ? 1 : 0;
		const planned = planOf(candidate, row);

		if (Object.keys(planned).length > 0) {
			plan.set(candidate.id, planned);
		}
	}

	return { plan, perRule: tallied.map(({ tally }) => tally), matched };
}
