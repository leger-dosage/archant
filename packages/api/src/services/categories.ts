import type { CreateCategoryRequest, UpdateCategoryRequest } from "../schemas/categories.ts";
import type { ServiceDeps } from "./deps.ts";

import { eq, inArray } from "drizzle-orm";

import type { CategoryIcon } from "@archant/data/category-presets";
import type { CategoryKind } from "@archant/data/schema/categories";
import { categories } from "@archant/data/schema/categories";
import type { Category } from "@archant/data/types";

import { AppError } from "../lib/errors.ts";
import { countByCategory, recategorise } from "./ledger.ts";

export type CategorySummary = {
	id: string;
	name: string;
	kind: CategoryKind;
	color: string;
	icon: CategoryIcon;
	/** `null` for a top-level category. */
	parentId: string | null;
	/** Transactions in this category itself, not in its children. */
	transactionCount: number;
};

type Db = ServiceDeps["db"];

const byName = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

const notFound = () => new AppError("NOT_FOUND", "No category has this id.");

const invalid = (path: string, code: string) =>
	new AppError("VALIDATION_ERROR", "The request is invalid.", [{ path, code }]);

function summarise(category: Category, counts: Map<string, number>): CategorySummary {
	return {
		id: category.id,
		name: category.name,
		kind: category.kind,
		color: category.color,
		icon: category.icon,
		parentId: category.parentId,
		transactionCount: counts.get(category.id) ?? 0,
	};
}

/**
 * Every category with its transaction count, sorted by name as a French
 * reader expects: « Épargne » under E. The whole set, not a page: a household
 * keeps a few dozen. The interface groups them by kind and parent.
 */
export async function listCategories(deps: ServiceDeps): Promise<CategorySummary[]> {
	const [rows, counts] = await Promise.all([
		deps.db.select().from(categories),
		countByCategory(deps),
	]);

	return rows
		.map((row) => summarise(row, counts))
		.toSorted((a, b) => byName.compare(a.name, b.name));
}

async function getCategory(deps: ServiceDeps, id: string): Promise<CategorySummary> {
	const row = await findCategory(deps.db, id);

	if (row === undefined) {
		throw notFound();
	}

	return summarise(row, await countByCategory(deps));
}

async function findCategory(db: Db, id: string): Promise<Category | undefined> {
	return db.select().from(categories).where(eq(categories.id, id)).get();
}

/**
 * `ids` with the children of every parent among them, as Sure filters: a
 * parent stands for its whole branch. Two levels at most, so one query
 * reaches every child. An unknown id stays, and matches no transaction.
 */
export async function withChildren(deps: ServiceDeps, ids: readonly string[]): Promise<string[]> {
	if (ids.length === 0) {
		return [];
	}

	const children = await deps.db
		.select({ id: categories.id })
		.from(categories)
		.where(inArray(categories.parentId, [...ids]));

	return [...new Set([...ids, ...children.map((child) => child.id)])];
}

async function hasChildren(db: Db, id: string): Promise<boolean> {
	const child = await db
		.select({ id: categories.id })
		.from(categories)
		.where(eq(categories.parentId, id))
		.limit(1)
		.get();

	return child !== undefined;
}

/**
 * Refuses a name another category holds, ignoring case. Compared here with a
 * locale-aware fold, since SQLite's `lower` in the unique index folds ASCII
 * only and would let « épargne » beside « Épargne ».
 */
async function assertNameFree(db: Db, name: string, ownId: string | null): Promise<void> {
	const folded = name.toLocaleLowerCase("fr");
	const rows = await db.select({ id: categories.id, name: categories.name }).from(categories);

	if (rows.some((row) => row.id !== ownId && row.name.toLocaleLowerCase("fr") === folded)) {
		throw invalid("name", "name_taken");
	}
}

/**
 * The parent a category may take: an existing top-level category other than
 * itself, and only if the category has no children, which would otherwise
 * end up on a third level.
 */
async function validParent(db: Db, parentId: string, ownId: string | null): Promise<Category> {
	const parent = parentId === ownId ? undefined : await findCategory(db, parentId);

	if (
		parent === undefined ||
		parent.parentId !== null ||
		(ownId !== null && (await hasChildren(db, ownId)))
	) {
		throw invalid("parentId", "invalid_parent");
	}

	return parent;
}

/** Creates a category; under a parent, it takes the parent's kind and colour. */
export async function createCategory(
	deps: ServiceDeps,
	input: CreateCategoryRequest,
): Promise<CategorySummary> {
	const id = crypto.randomUUID();

	await deps.db.transaction(
		async (tx) => {
			await assertNameFree(tx, input.name, null);
			const parent = input.parentId === null ? null : await validParent(tx, input.parentId, null);
			const now = Date.now();

			await tx.insert(categories).values({
				id,
				name: input.name,
				kind: parent?.kind ?? input.kind,
				color: parent?.color ?? input.color,
				icon: input.icon,
				parentId: parent?.id ?? null,
				createdAt: now,
				updatedAt: now,
			});
		},
		{ behavior: "immediate" },
	);

	return getCategory(deps, id);
}

/**
 * Renames, recolours, re-icons or moves a category. A child takes its
 * parent's kind and colour whatever the patch says, and a top-level
 * category passes a new kind or colour on to its children in the same
 * transaction, so the two never disagree.
 */
export async function updateCategory(
	deps: ServiceDeps,
	id: string,
	patch: UpdateCategoryRequest,
): Promise<CategorySummary> {
	await deps.db.transaction(
		async (tx) => {
			const current = await findCategory(tx, id);

			if (current === undefined) {
				throw notFound();
			}

			if (patch.name !== undefined) {
				await assertNameFree(tx, patch.name, id);
			}

			const parentId = patch.parentId === undefined ? current.parentId : patch.parentId;
			const parent = parentId === null ? null : await validParent(tx, parentId, id);
			const kind = parent?.kind ?? patch.kind ?? current.kind;
			const color = parent?.color ?? patch.color ?? current.color;
			const now = Date.now();

			await tx
				.update(categories)
				.set({
					name: patch.name ?? current.name,
					kind,
					color,
					icon: patch.icon ?? current.icon,
					parentId,
					updatedAt: now,
				})
				.where(eq(categories.id, id));

			if (parent === null) {
				await tx
					.update(categories)
					.set({ kind, color, updatedAt: now })
					.where(eq(categories.parentId, id));
			}
		},
		{ behavior: "immediate" },
	);

	return getCategory(deps, id);
}

/**
 * Deletes a category. Its transactions move to `replacementId`, or become
 * uncategorised without one; its children become top-level and keep their
 * kind and colour, as in Sure. One transaction for all three.
 */
export async function deleteCategory(
	deps: ServiceDeps,
	id: string,
	replacementId: string | undefined,
): Promise<{ id: string; moved: number }> {
	return deps.db.transaction(
		async (tx) => {
			if ((await findCategory(tx, id)) === undefined) {
				throw notFound();
			}

			if (
				replacementId !== undefined &&
				(replacementId === id || (await findCategory(tx, replacementId)) === undefined)
			) {
				throw invalid("replacementId", "invalid_value");
			}

			const moved = await recategorise({ ...deps, db: tx }, id, replacementId ?? null, {
				origin: "maintenance",
			});
			await tx
				.update(categories)
				.set({ parentId: null, updatedAt: Date.now() })
				.where(eq(categories.parentId, id));
			await tx.delete(categories).where(eq(categories.id, id));

			return { id, moved };
		},
		{ behavior: "immediate" },
	);
}

/**
 * Merges a category into `targetId`: its transactions move to the target,
 * its children move under the target and take its kind and colour, then it
 * is deleted. Across kinds too, since the kind only groups the display
 * (AD-9). A category with children cannot merge into a child, its own or
 * another's: they would land on a third level. Returns the target.
 */
export async function mergeCategory(
	deps: ServiceDeps,
	id: string,
	targetId: string,
): Promise<CategorySummary> {
	await deps.db.transaction(
		async (tx) => {
			const source = await findCategory(tx, id);

			if (source === undefined) {
				throw notFound();
			}

			const target = targetId === id ? undefined : await findCategory(tx, targetId);

			if (
				target === undefined ||
				(target.parentId !== null && (await hasChildren(tx, source.id)))
			) {
				throw invalid("targetId", "invalid_value");
			}

			await recategorise({ ...deps, db: tx }, source.id, target.id, { origin: "maintenance" });
			await tx
				.update(categories)
				.set({
					parentId: target.id,
					kind: target.kind,
					color: target.color,
					updatedAt: Date.now(),
				})
				.where(eq(categories.parentId, source.id));
			await tx.delete(categories).where(eq(categories.id, source.id));
		},
		{ behavior: "immediate" },
	);

	return getCategory(deps, targetId);
}
