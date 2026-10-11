import type { ServiceDeps } from "./deps.ts";

import { and, eq, inArray } from "drizzle-orm";

import { FUNDABLE_ACCOUNT_TYPES } from "@archant/data/goals";
import { accounts } from "@archant/data/schema/accounts";
import { categories } from "@archant/data/schema/categories";
import { merchants } from "@archant/data/schema/merchants";
import { tags } from "@archant/data/schema/tags";

/** A row another one points to, as Sure's assistant functions give it: `{ id, name }`. */
export type NamedRef = { id: string; name: string };

/**
 * The names Sure's `get_transactions` and `update_budget` take for « Sans
 * catégorie »: Sure's English and French names, the French one being what
 * `get_income_statement` lists, and the one Archant shows.
 */
const UNCATEGORISED_NAMES = ["Uncategorized", "Non catégorisé", "Sans catégorie"];

/** Whether `ref` names « Sans catégorie », case aside, as Sure's `casecmp?`. */
export function isUncategorisedName(ref: string): boolean {
	return UNCATEGORISED_NAMES.some((name) => fold(name) === fold(ref));
}

type NamedTable = typeof accounts | typeof categories | typeof merchants | typeof tags;

const TABLES = { accounts, categories, merchants, tags } as const;

type Kind = keyof typeof TABLES;

/** The ids each kind of row is looked up by, in any order, repeats allowed. */
export type IdsToName = Partial<Record<Kind, Iterable<string>>>;

/** Each kind's names by id, for the ids asked that still exist. */
export type NameBook = Record<Kind, ReadonlyMap<string, string>>;

async function namesIn(
	deps: ServiceDeps,
	table: NamedTable,
	ids: Iterable<string> | undefined,
): Promise<ReadonlyMap<string, string>> {
	const unique = [...new Set(ids ?? [])];

	if (unique.length === 0) {
		return new Map();
	}

	const rows = await deps.db
		.select({ id: table.id, name: table.name })
		.from(table)
		.where(inArray(table.id, unique));

	return new Map(rows.map((row) => [row.id, row.name]));
}

/**
 * The names of the rows a tool's answer points to, so it gives each as
 * Sure's `{ id, name }`: four reads by id, whatever the rows' number.
 */
export async function namesOf(deps: ServiceDeps, ids: IdsToName): Promise<NameBook> {
	const [accountNames, categoryNames, merchantNames, tagNames] = await Promise.all([
		namesIn(deps, accounts, ids.accounts),
		namesIn(deps, categories, ids.categories),
		namesIn(deps, merchants, ids.merchants),
		namesIn(deps, tags, ids.tags),
	]);

	return {
		accounts: accountNames,
		categories: categoryNames,
		merchants: merchantNames,
		tags: tagNames,
	};
}

/** The ref an id names, `null` for none; an id deleted since reads as its id. */
export function refOf(names: ReadonlyMap<string, string>, id: string | null): NamedRef | null {
	return id === null ? null : { id, name: names.get(id) ?? id };
}

/**
 * The ids of the rows these exact names, case included, name, as Sure's
 * filters match them: an account name several accounts share names them
 * all, and a name nothing holds names nothing. `undefined` when no name was
 * given, so the filter stays open.
 */
export async function idsNamed(
	deps: ServiceDeps,
	kind: Kind,
	names: readonly string[] | undefined,
): Promise<string[] | undefined> {
	if (names === undefined) {
		return undefined;
	}

	if (names.length === 0) {
		return [];
	}

	const table = TABLES[kind];
	const rows = await deps.db
		.select({ id: table.id })
		.from(table)
		.where(inArray(table.name, [...names]));

	return rows.map((row) => row.id);
}

/**
 * Category filter names as the list's filter takes them: « Sans catégorie »
 * or Sure's "Uncategorized" become `none`, unless a category of the household
 * holds that very name, which Sure takes for what was meant.
 */
export async function categoryFilterNamed(
	deps: ServiceDeps,
	names: readonly string[] | undefined,
): Promise<string[] | undefined> {
	if (names === undefined) {
		return undefined;
	}

	const real = new Set(
		(
			await deps.db
				.select({ name: categories.name })
				.from(categories)
				.where(inArray(categories.name, UNCATEGORISED_NAMES))
		).map((row) => row.name),
	);
	const uncategorised = names.some((name) => UNCATEGORISED_NAMES.includes(name) && !real.has(name));
	const ids = await idsNamed(
		deps,
		"categories",
		names.filter((name) => !UNCATEGORISED_NAMES.includes(name) || real.has(name)),
	);

	return [...(ids ?? []), ...(uncategorised ? ["none"] : [])];
}

/**
 * The ids of the active accounts this exact name, case included, names,
 * two at most, as the bill dialog offers only active ones, as Sure's bill tools look an account up: one is the account, two say
 * the name is shared and no write may pick between them.
 */
export async function accountsNamed(deps: ServiceDeps, name: string): Promise<string[]> {
	const rows = await deps.db
		.select({ id: accounts.id })
		.from(accounts)
		.where(and(eq(accounts.name, name), eq(accounts.active, true)))
		.limit(2);

	return rows.map((row) => row.id);
}

/** An account a goal may take, as `create_goal` finds it by name. */
type FundableAccount = { id: string; name: string; currency: string };

/**
 * Every account these exact names, case included, name among those that may
 * back a goal, active and fundable as `canBackGoal` says, as Sure's
 * `create_goal` looks among the visible `Depository` accounts: a name two
 * accounts share gives both, so the tool refuses it rather than pick one.
 */
export async function fundableAccountsNamed(
	deps: ServiceDeps,
	names: readonly string[],
): Promise<FundableAccount[]> {
	if (names.length === 0) {
		return [];
	}

	return deps.db
		.select({ id: accounts.id, name: accounts.name, currency: accounts.currency })
		.from(accounts)
		.where(
			and(
				inArray(accounts.name, [...new Set(names)]),
				eq(accounts.active, true),
				inArray(accounts.type, [...FUNDABLE_ACCOUNT_TYPES]),
			),
		)
		.orderBy(accounts.name, accounts.id);
}

/** A name as Sure's `LOWER(name) = ref.downcase` compares it. */
const fold = (value: string) => value.trim().toLocaleLowerCase("fr");

/** A category as Sure's `update_budget` finds it. */
type FoundCategory = { id: string; name: string; kind: string; parentId: string | null };

/**
 * Sure's `find_budget_category!` lookup: each reference's category by its
 * id, else by its name, case aside; `undefined` for one nothing matches.
 */
export async function categoriesByRef(
	deps: ServiceDeps,
	refs: readonly string[],
): Promise<Map<string, FoundCategory | undefined>> {
	const rows = await deps.db
		.select({
			id: categories.id,
			name: categories.name,
			kind: categories.kind,
			parentId: categories.parentId,
		})
		.from(categories);

	return new Map(
		refs.map((ref) => [
			ref,
			rows.find((row) => row.id === ref.trim()) ?? rows.find((row) => fold(row.name) === fold(ref)),
		]),
	);
}

/**
 * The id of the tag this exact name names, case included, as Sure's
 * `update_tag` finds it; `undefined` when none does.
 */
export async function tagIdNamed(deps: ServiceDeps, name: string): Promise<string | undefined> {
	const [id] = (await idsNamed(deps, "tags", [name])) ?? [];

	return id;
}
