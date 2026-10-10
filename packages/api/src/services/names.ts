import type { ServiceDeps } from "./deps.ts";

import { inArray } from "drizzle-orm";

import { accounts } from "@archant/data/schema/accounts";
import { categories } from "@archant/data/schema/categories";
import { merchants } from "@archant/data/schema/merchants";
import { tags } from "@archant/data/schema/tags";

/** A row another one points to, as Sure's assistant functions give it: `{ id, name }`. */
export type NamedRef = { id: string; name: string };

/**
 * The names Sure's `get_transactions` and `update_budget` take for « Sans
 * catégorie »: its English name, and the one Archant shows.
 */
const UNCATEGORISED_NAMES = ["Uncategorized", "Sans catégorie"];

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
 * Sure's `category` of `update_budget` and `category_name` of the bill tools:
 * a category's id, or its name, case aside where `caseInsensitive`. « Sans
 * catégorie » and "Uncategorized" read as `null`, unless a category holds
 * that name. A reference nothing matches is returned as it was, so the
 * service refuses it as the unknown id it is.
 */
export async function categoryIdsOf(
	deps: ServiceDeps,
	refs: readonly string[],
	options: { caseInsensitive: boolean },
): Promise<Map<string, string | null>> {
	const rows = await deps.db.select({ id: categories.id, name: categories.name }).from(categories);
	const fold = (value: string) => (options.caseInsensitive ? value.toLocaleLowerCase("fr") : value);

	return new Map(
		refs.map((ref) => {
			const byId = rows.find((row) => row.id === ref);
			const byName = rows.find((row) => fold(row.name) === fold(ref.trim()));
			const found = byId ?? byName;

			if (found !== undefined) {
				return [ref, found.id];
			}

			return [ref, UNCATEGORISED_NAMES.includes(ref.trim()) ? null : ref];
		}),
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
