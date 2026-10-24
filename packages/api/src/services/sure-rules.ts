import type { RuleInput } from "../schemas/rules.ts";
import type { Transaction } from "./ledger/shared.ts";

import Papa from "papaparse";

import { CATEGORY_NAME_MAX_LENGTH, newCategory } from "@archant/data/category-presets";
import { MERCHANT_NAME_MAX_LENGTH, TAG_NAME_MAX_LENGTH } from "@archant/data/name-limits";
import { RULE_ACTION_TYPES, RULE_CONDITION_TYPES, isValuelessOperator } from "@archant/data/rules";
import { categories } from "@archant/data/schema/categories";
import { merchants } from "@archant/data/schema/merchants";
import { tags } from "@archant/data/schema/tags";

import { oneByOne } from "./ledger/shared.ts";
import { cut } from "./sure-import-plan.ts";
import { foldName } from "./sure-import-preflight.ts";

// A rule in Sure's export shape read into Archant's terms, shared by the
// archive import (Story 30.1) and the rules CSV import (Story 30.3): Sure's
// `rule_operand_value`, its `find_or_create_rule_*` by name, and Archant's
// refusals of what it cannot hold.

/** A name not taken yet, folded as `assertNameFree` compares names, or the row holding it. */
export type NameBook = Map<string, string>;

async function nameBook(
	tx: Pick<Transaction, "select">,
	table: typeof categories | typeof tags | typeof merchants,
): Promise<NameBook> {
	const rows = await tx.select({ id: table.id, name: table.name }).from(table);

	return new Map(rows.map((row) => [foldName(row.name), row.id]));
}

export type Taxonomy = {
	/** An archive's own ids, mapped to the rows the import wrote; empty for a CSV file. */
	ids: {
		categories: Map<string, string>;
		tags: Map<string, string>;
		merchants: Map<string, string>;
	};
	names: { categories: NameBook; tags: NameBook; merchants: NameBook };
};

/** The household's categories, tags and merchants by folded name, no archive id yet. */
export async function taxonomyOf(tx: Pick<Transaction, "select">): Promise<Taxonomy> {
	return {
		ids: { categories: new Map(), tags: new Map(), merchants: new Map() },
		names: {
			categories: await nameBook(tx, categories),
			tags: await nameBook(tx, tags),
			merchants: await nameBook(tx, merchants),
		},
	};
}

type Data = Record<string, unknown>;

const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const isData = (value: unknown): value is Data =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Sure's `rule_operand_value`: a value, else the name its `value_ref` gives. */
function operandOf(data: Data): string | null {
	const raw = data.value;
	const value = typeof raw === "string" ? (raw.trim() === "" ? null : raw) : raw;
	// A blank name is no operand: the rule then fails `ruleSchema` and is skipped.
	const refName =
		isData(data.value_ref) &&
		typeof data.value_ref.name === "string" &&
		data.value_ref.name.trim() !== ""
			? data.value_ref.name
			: null;

	if (typeof value === "string" && UUID_PATTERN.test(value) && refName !== null) {
		return refName;
	}

	if (value !== null && value !== undefined) {
		return typeof value === "string"
			? value
			: typeof value === "number" || typeof value === "boolean"
				? String(value)
				: null;
	}

	return refName;
}

type ReferenceKind = "categories" | "merchants" | "tags";

/** The longest name each kind of row takes, as its form bounds it. */
const NAME_LIMITS: Record<ReferenceKind, number> = {
	categories: CATEGORY_NAME_MAX_LENGTH,
	merchants: MERCHANT_NAME_MAX_LENGTH,
	tags: TAG_NAME_MAX_LENGTH,
};

/** A row a rule names that does not exist yet, created only once the rule is kept. */
type Missing = { kind: ReferenceKind; id: string; name: string };

/**
 * What one rule's operands resolve against. `missing` collects the rows it
 * names that nobody holds, so a rule skipped or refused leaves none behind.
 */
export type RuleContext = {
	taxonomy: Taxonomy;
	/** The accounts a rule may name, by the id its file gives. */
	accounts: ReadonlyMap<string, { id: string }>;
	missing: Map<string, Missing>;
};

/**
 * The id of the category, merchant or tag a rule names: an archive's own id
 * maps through the import, a name finds the row holding it, else a new id
 * the rule creates when it is kept, as Sure's `find_or_create_rule_*`.
 */
function referenceId(context: RuleContext, kind: ReferenceKind, value: string): string {
	const known =
		context.taxonomy.ids[kind].get(value) ?? context.taxonomy.names[kind].get(foldName(value));

	if (known !== undefined) {
		return known;
	}

	const key = `${kind} ${foldName(value)}`;
	const missing = context.missing.get(key) ?? {
		kind,
		id: crypto.randomUUID(),
		name: cut(value.trim(), NAME_LIMITS[kind]),
	};

	context.missing.set(key, missing);

	return missing.id;
}

/** Creates the rows a kept rule named, and books them for the rules after it. */
export async function createMissing(
	tx: Transaction,
	taxonomy: Taxonomy,
	missing: Iterable<Missing>,
	now: number,
): Promise<void> {
	const stamps = { createdAt: now, updatedAt: now };

	await oneByOne([...missing], async ({ kind, id, name }) => {
		if (kind === "categories") {
			const preset = newCategory(name);

			await tx.insert(categories).values({
				id,
				name,
				color: preset.color,
				icon: preset.icon,
				parentId: null,
				...stamps,
			});
		} else {
			await tx.insert(kind === "tags" ? tags : merchants).values({ id, name, ...stamps });
		}

		taxonomy.names[kind].set(foldName(name), id);
	});
}

const REFERENCE_CONDITIONS = {
	transaction_category: "categories",
	transaction_merchant: "merchants",
	transaction_tag: "tags",
} as const;

type ConditionInput = RuleInput["conditions"][number];

/** A condition in Archant's terms, `null` when Archant lacks it and the rule is refused. */
function conditionOf(context: RuleContext, data: unknown): ConditionInput | null {
	if (
		!isData(data) ||
		typeof data.condition_type !== "string" ||
		typeof data.operator !== "string"
	) {
		return null;
	}

	const type = RULE_CONDITION_TYPES.find((known) => known === data.condition_type);

	if (type === undefined) {
		return null;
	}

	if (type === "compound") {
		const children = listOf(data.sub_conditions).map((child) => conditionOf(context, child));

		return children.some((child) => child === null)
			? null
			: {
					conditionType: type,
					operator: data.operator,
					conditions: children.filter((child) => child !== null),
				};
	}

	const value = isValuelessOperator(data.operator) ? null : operandOf(data);

	if (value === null) {
		return { conditionType: type, operator: data.operator, value: null };
	}

	if (type === "transaction_account") {
		const account = context.accounts.get(value);

		return account === undefined
			? null
			: { conditionType: type, operator: data.operator, value: account.id };
	}

	const reference =
		type === "transaction_category" || type === "transaction_merchant" || type === "transaction_tag"
			? REFERENCE_CONDITIONS[type]
			: null;

	return {
		conditionType: type,
		operator: data.operator,
		value: reference === null ? value : referenceId(context, reference, value),
	};
}

/** Sure's `resolve_multi_tag_action_value`: the names of `value_ref`, else of the value's CSV line. */
function tagsValue(context: RuleContext, data: Data): string {
	const refs = Array.isArray(data.value_ref)
		? data.value_ref
		: isData(data.value_ref)
			? [data.value_ref]
			: [];
	const names =
		refs.length > 0
			? refs.map((ref) => (isData(ref) && typeof ref.name === "string" ? ref.name : ""))
			: typeof data.value === "string"
				? (Papa.parse<string[]>(data.value).data[0] ?? [])
				: [];
	const ids = names
		.filter((name) => name.trim() !== "")
		.map((name) => referenceId(context, "tags", name));

	return [...new Set(ids)].join(",");
}

type ActionInput = RuleInput["actions"][number];

/** An action in Archant's terms; `null` when Archant lacks it, which drops it. */
function actionOf(context: RuleContext, data: unknown): ActionInput | null {
	if (!isData(data)) {
		return null;
	}

	const type = RULE_ACTION_TYPES.find((known) => known === data.action_type);

	switch (type) {
		case undefined:
		case "replace_in_transaction_name":
			return null;
		case "exclude_transaction":
			return { actionType: type, value: null };
		case "set_transaction_tags":
			return { actionType: type, value: tagsValue(context, data) };
		case "set_as_transfer_or_payment": {
			const account = context.accounts.get(operandOf(data) ?? "");

			return account === undefined ? null : { actionType: type, value: account.id };
		}
		default: {
			const value = operandOf(data);

			if (value === null) {
				return { actionType: type, value: null };
			}

			return {
				actionType: type,
				value:
					type === "set_transaction_category"
						? referenceId(context, "categories", value)
						: type === "set_transaction_merchant"
							? referenceId(context, "merchants", value)
							: value,
			};
		}
	}
}

/**
 * A rule in Archant's terms, `null` when Archant cannot hold it: a condition
 * Archant lacks would make it match more than it did, and a rule left
 * without an action does nothing. `archant.actions` restores a replacement
 * in the label.
 */
export function ruleInputOf(context: RuleContext, data: Data): RuleInput | null {
	const conditions = listOf(data.conditions).map((condition) => conditionOf(context, condition));

	if (conditions.some((condition) => condition === null)) {
		return null;
	}

	const archant = isData(data.archant) ? data.archant : {};
	const actions = [
		...listOf(data.actions)
			.map((action) => actionOf(context, action))
			.filter((action) => action !== null),
		...listOf(archant.actions).flatMap((own): ActionInput[] =>
			isData(own) &&
			own.action_type === "replace_in_transaction_name" &&
			typeof own.value === "string"
				? [
						{
							actionType: "replace_in_transaction_name",
							value: own.value,
							replacement: typeof own.replacement === "string" ? own.replacement : "",
						},
					]
				: [],
		),
	];

	if (actions.length === 0) {
		return null;
	}

	return {
		name: typeof data.name === "string" ? data.name : null,
		effectiveDate:
			typeof data.effective_date === "string" && data.effective_date !== ""
				? data.effective_date.slice(0, 10)
				: null,
		conditions: conditions.filter((condition) => condition !== null),
		actions,
	};
}
