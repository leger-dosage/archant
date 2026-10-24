import type { TagRequest } from "../schemas/tags.ts";
import type { ServiceDeps } from "./deps.ts";

import { eq } from "drizzle-orm";

import { sampleCategoryColor } from "@archant/data/category-presets";
import { tags } from "@archant/data/schema/tags";
import type { Tag } from "@archant/data/types";

import { AppError } from "../lib/errors.ts";
import { countByTag, removeAllTags, removeTag, replaceTag } from "./ledger/edits.ts";
import { assertNameFree } from "./names.ts";

export type TagSummary = {
	id: string;
	name: string;
	color: string;
	transactionCount: number;
};

type Db = ServiceDeps["db"];

const byName = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

const notFound = () => new AppError("NOT_FOUND", "No tag has this id.");

const invalid = (path: string, code: string) =>
	new AppError("VALIDATION_ERROR", "The request is invalid.", [{ path, code }]);

function summarise(tag: Tag, counts: Map<string, number>): TagSummary {
	return {
		id: tag.id,
		name: tag.name,
		color: tag.color,
		transactionCount: counts.get(tag.id) ?? 0,
	};
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

export async function createTag(deps: ServiceDeps, input: TagRequest): Promise<TagSummary> {
	const id = crypto.randomUUID();

	await deps.db.transaction(
		async (tx) => {
			await assertNameFree(tx, tags, input.name, null);
			const now = Date.now();

			await tx.insert(tags).values({
				id,
				name: input.name,
				color: input.color ?? sampleCategoryColor(),
				createdAt: now,
				updatedAt: now,
			});
		},
		{ behavior: "immediate" },
	);

	return getTag(deps, id);
}

/** Renames a tag, and recolours it when given; every transaction carrying it shows both. */
export async function updateTag(
	deps: ServiceDeps,
	id: string,
	input: TagRequest,
): Promise<TagSummary> {
	await deps.db.transaction(
		async (tx) => {
			if ((await findTag(tx, id)) === undefined) {
				throw notFound();
			}

			await assertNameFree(tx, tags, input.name, id);
			await tx
				.update(tags)
				.set({
					name: input.name,
					...(input.color === undefined ? {} : { color: input.color }),
					updatedAt: Date.now(),
				})
				.where(eq(tags.id, id));
		},
		{ behavior: "immediate" },
	);

	return getTag(deps, id);
}

/**
 * Deletes a tag, as Sure's `replace_and_destroy!`: with a replacement, each
 * transaction carrying it carries the replacement instead, once; without,
 * it loses the tag. Locks stay. Returns how many transactions it marked.
 * One transaction for all.
 */
export async function deleteTag(
	deps: ServiceDeps,
	id: string,
	replacementId?: string,
): Promise<{ id: string; untagged: number }> {
	return deps.db.transaction(
		async (tx) => {
			if ((await findTag(tx, id)) === undefined) {
				throw notFound();
			}

			if (
				replacementId !== undefined &&
				(replacementId === id || (await findTag(tx, replacementId)) === undefined)
			) {
				throw invalid("replacementId", "invalid_value");
			}

			const ledger = { ...deps, db: tx };
			const untagged =
				replacementId === undefined
					? await removeTag(ledger, id, { origin: "maintenance" })
					: await replaceTag(ledger, id, replacementId, { origin: "maintenance" });
			await tx.delete(tags).where(eq(tags.id, id));

			return { id, untagged };
		},
		{ behavior: "immediate" },
	);
}

/**
 * Deletes every tag, as Sure's `destroy_all`: every transaction loses its
 * tags, locks kept. Returns how many tags went.
 */
export async function deleteAllTags(deps: ServiceDeps): Promise<{ deleted: number }> {
	return deps.db.transaction(
		async (tx) => {
			await removeAllTags({ ...deps, db: tx });
			const result = await tx.delete(tags);

			return { deleted: result.rowsAffected };
		},
		{ behavior: "immediate" },
	);
}
