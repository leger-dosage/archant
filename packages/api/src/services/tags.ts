import type { TagRequest } from "../schemas/tags.ts";
import type { ServiceDeps } from "./deps.ts";

import { eq } from "drizzle-orm";

import { tags } from "@archant/data/schema/tags";
import type { Tag } from "@archant/data/types";

import { AppError } from "../lib/errors.ts";
import { countByTag, removeTag } from "./ledger.ts";

export type TagSummary = {
	id: string;
	name: string;
	transactionCount: number;
};

type Db = ServiceDeps["db"];

const byName = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

const notFound = () => new AppError("NOT_FOUND", "No tag has this id.");

function summarise(tag: Tag, counts: Map<string, number>): TagSummary {
	return { id: tag.id, name: tag.name, transactionCount: counts.get(tag.id) ?? 0 };
}

/**
 * Every tag with its transaction count, sorted by name as a French reader
 * expects. The whole set, not a page: the interface resolves each row's tag
 * names from it, as it does for merchants.
 */
export async function listTags(deps: ServiceDeps): Promise<TagSummary[]> {
	const [rows, counts] = await Promise.all([deps.db.select().from(tags), countByTag(deps)]);

	return rows
		.map((row) => summarise(row, counts))
		.toSorted((a, b) => byName.compare(a.name, b.name));
}

async function findTag(db: Db, id: string): Promise<Tag | undefined> {
	return db.select().from(tags).where(eq(tags.id, id)).get();
}

async function getTag(deps: ServiceDeps, id: string): Promise<TagSummary> {
	const row = await findTag(deps.db, id);

	if (row === undefined) {
		throw notFound();
	}

	return summarise(row, await countByTag(deps));
}

/**
 * Refuses a name another tag holds, ignoring case. Compared here with a
 * locale-aware fold, since SQLite's `lower` in the unique index folds ASCII
 * only and would let « été » beside « Été ».
 */
async function assertNameFree(db: Db, name: string, ownId: string | null): Promise<void> {
	const folded = name.toLocaleLowerCase("fr");
	const rows = await db.select({ id: tags.id, name: tags.name }).from(tags);

	if (rows.some((row) => row.id !== ownId && row.name.toLocaleLowerCase("fr") === folded)) {
		throw new AppError("VALIDATION_ERROR", "The request is invalid.", [
			{ path: "name", code: "name_taken" },
		]);
	}
}

export async function createTag(deps: ServiceDeps, input: TagRequest): Promise<TagSummary> {
	const id = crypto.randomUUID();

	await deps.db.transaction(
		async (tx) => {
			await assertNameFree(tx, input.name, null);
			const now = Date.now();

			await tx.insert(tags).values({ id, name: input.name, createdAt: now, updatedAt: now });
		},
		{ behavior: "immediate" },
	);

	return getTag(deps, id);
}

/** Renames a tag; every transaction carrying it shows the new name. */
export async function renameTag(
	deps: ServiceDeps,
	id: string,
	input: TagRequest,
): Promise<TagSummary> {
	await deps.db.transaction(
		async (tx) => {
			if ((await findTag(tx, id)) === undefined) {
				throw notFound();
			}

			await assertNameFree(tx, input.name, id);
			await tx.update(tags).set({ name: input.name, updatedAt: Date.now() }).where(eq(tags.id, id));
		},
		{ behavior: "immediate" },
	);

	return getTag(deps, id);
}

/**
 * Deletes a tag after removing it from its transactions, which keep their
 * locks, and returns how many lost it. One transaction for both.
 */
export async function deleteTag(
	deps: ServiceDeps,
	id: string,
): Promise<{ id: string; untagged: number }> {
	return deps.db.transaction(
		async (tx) => {
			if ((await findTag(tx, id)) === undefined) {
				throw notFound();
			}

			const untagged = await removeTag({ ...deps, db: tx }, id, { origin: "maintenance" });
			await tx.delete(tags).where(eq(tags.id, id));

			return { id, untagged };
		},
		{ behavior: "immediate" },
	);
}
