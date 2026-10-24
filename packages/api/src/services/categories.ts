import type { CreateCategoryRequest, UpdateCategoryRequest } from "../schemas/categories.ts";
import type { ServiceDeps } from "./deps.ts";

import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";

import type { CategoryIcon } from "@archant/data/category-presets";
import { sampleCategoryColor } from "@archant/data/category-presets";
import { budgetCategories } from "@archant/data/schema/budgets";
import { categories } from "@archant/data/schema/categories";
import { recurringTransactions } from "@archant/data/schema/recurring-transactions";
import type { Category } from "@archant/data/types";

import { AppError } from "../lib/errors.ts";
import { DEFAULT_CATEGORIES } from "./default-categories.ts";
import { countByCategory, recategorise, uncategoriseAll } from "./ledger/edits.ts";
import { assertNameFree } from "./names.ts";

export type CategorySummary = {
	id: string;
	name: string;
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
		color: category.color,
		icon: category.icon,
		parentId: category.parentId,
		transactionCount: counts.get(category.id) ?? 0,
	};
}

/**
 * Every category with its transaction count, sorted by name as a French
 * reader expects: « Épargne » under E. The whole set, not a page: a household
 * keeps a few dozen. The interface groups them by parent.
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

/**
 * Creates a category; under a parent, it takes the parent's colour, and
 * without a colour one of the ten at random, as Sure's `COLORS.sample`.
 */
export async function createCategory(
	deps: ServiceDeps,
	input: CreateCategoryRequest,
): Promise<CategorySummary> {
	const id = crypto.randomUUID();

	await deps.db.transaction(
		async (tx) => {
			await assertNameFree(tx, categories, input.name, null);
			const parent = input.parentId === null ? null : await validParent(tx, input.parentId, null);
			const now = Date.now();

			await tx.insert(categories).values({
				id,
				name: input.name,
				color: parent?.color ?? input.color ?? sampleCategoryColor(),
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
 * parent's colour whatever the patch says, as Sure's
 * `inherit_color_from_parent`, and a top-level category passes a new colour
 * on to its children in the same transaction, so the two never disagree.
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
				await assertNameFree(tx, categories, patch.name, id);
			}

			const parentId = patch.parentId === undefined ? current.parentId : patch.parentId;
			const parent = parentId === null ? null : await validParent(tx, parentId, id);
			const color = parent?.color ?? patch.color ?? current.color;
			const now = Date.now();

			await tx
				.update(categories)
				.set({
					name: patch.name ?? current.name,
					color,
					icon: patch.icon ?? current.icon,
					parentId,
					updatedAt: now,
				})
				.where(eq(categories.id, id));

			if (parent === null) {
				await tx
					.update(categories)
					.set({ color, updatedAt: now })
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
 * colour, as in Sure. One transaction for all three.
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

/** Runs `run` on each item, one after the other, inside one transaction. */
async function inOrder<Item>(items: readonly Item[], run: (item: Item) => Promise<unknown>) {
	await items.reduce<Promise<unknown>>(
		(previous, item) => previous.then(() => run(item)),
		Promise.resolve(),
	);
}

/**
 * Moves the budget lines of `sourceIds` to `targetId`, as Sure's
 * `merge_budget_categories`: in a month where the target has a line, the
 * sources' integer amounts add to it; in any other, the first source's line
 * changes category and takes the month's sum. The other lines go.
 */
async function mergeBudgetLines(db: Db, sourceIds: string[], targetId: string): Promise<void> {
	const lines = await db
		.select()
		.from(budgetCategories)
		.where(inArray(budgetCategories.categoryId, [...sourceIds, targetId]));
	const months = new Map<string, (typeof lines)[number][]>();

	lines.forEach((line) => months.set(line.budgetId, [...(months.get(line.budgetId) ?? []), line]));
	const now = Date.now();

	await inOrder([...months.values()], (monthLines) => {
		const target = monthLines.find((line) => line.categoryId === targetId);
		const sources = monthLines.filter((line) => line.categoryId !== targetId);
		const kept = target ?? sources[0];

		if (kept === undefined || sources.length === 0) {
			return Promise.resolve();
		}

		return db
			.update(budgetCategories)
			.set({
				categoryId: targetId,
				budgetedSpending: monthLines.reduce((sum, line) => sum + line.budgetedSpending, 0),
				updatedAt: now,
			})
			.where(eq(budgetCategories.id, kept.id));
	});
	await db.delete(budgetCategories).where(inArray(budgetCategories.categoryId, sourceIds));
}

/**
 * Merges `sourceIds` into `targetId`, as Sure's `Category::Merger`: the
 * sources' transactions and budget lines move to the target, their children
 * other than the target move under it and take its colour, then they go.
 * Refused before any write when the target is among the sources, sits under
 * one of them, or is a child while a source has children, which would land
 * on a third level. Returns the target.
 */
export async function mergeCategories(
	deps: ServiceDeps,
	targetId: string,
	sourceIds: readonly string[],
): Promise<CategorySummary> {
	await deps.db.transaction(
		async (tx) => {
			const target = await findCategory(tx, targetId);

			if (target === undefined) {
				throw invalid("targetId", "invalid_value");
			}

			if (sourceIds.includes(targetId)) {
				throw invalid("sourceIds", "same_category");
			}

			const ids = [...new Set(sourceIds)];
			const sources = await tx.select().from(categories).where(inArray(categories.id, ids));

			if (sources.length !== ids.length) {
				throw invalid("sourceIds", "invalid_value");
			}

			// Two levels at most, so the target's parent is its only ancestor.
			if (target.parentId !== null && ids.includes(target.parentId)) {
				throw invalid("targetId", "parent_child");
			}

			const child = await tx
				.select({ id: categories.id })
				.from(categories)
				.where(inArray(categories.parentId, ids))
				.limit(1)
				.get();

			if (target.parentId !== null && child !== undefined) {
				throw invalid("targetId", "invalid_parent");
			}

			await inOrder(ids, (id) =>
				recategorise({ ...deps, db: tx }, id, target.id, { origin: "maintenance" }),
			);
			await mergeBudgetLines(tx, ids, target.id);
			// Archant's own: a recurring series keeps a category Sure's has not,
			// and follows it into the target rather than losing it on delete.
			await tx
				.update(recurringTransactions)
				.set({ categoryId: target.id, updatedAt: Date.now() })
				.where(inArray(recurringTransactions.categoryId, ids));
			await tx
				.update(categories)
				.set({ parentId: target.id, color: target.color, updatedAt: Date.now() })
				.where(and(inArray(categories.parentId, ids), ne(categories.id, target.id)));
			await tx.delete(categories).where(inArray(categories.id, ids));
		},
		{ behavior: "immediate" },
	);

	return getCategory(deps, targetId);
}

/**
 * Deletes every category, as Sure's `destroy_all`: transactions become
 * uncategorised, budget lines go with their category, and a recurring
 * series loses its category through its foreign key. Children go first, since
 * a parent's key restricts its deletion. Returns how many went.
 */
export async function deleteAllCategories(deps: ServiceDeps): Promise<{ deleted: number }> {
	return deps.db.transaction(
		async (tx) => {
			await uncategoriseAll({ ...deps, db: tx });
			const children = await tx.delete(categories).where(isNotNull(categories.parentId));
			const parents = await tx.delete(categories);

			return { deleted: children.rowsAffected + parents.rowsAffected };
		},
		{ behavior: "immediate" },
	);
}

/**
 * Creates each default no category holds by name, case aside, as Sure's
 * `Category.bootstrap!` finds or creates by name: an existing one keeps its
 * colour, icon and parent. Returns how many it created.
 */
export async function bootstrapCategories(deps: ServiceDeps): Promise<{ created: number }> {
	return deps.db.transaction(
		async (tx) => {
			const held = new Set(
				(await tx.select({ name: categories.name }).from(categories)).map((row) =>
					row.name.toLocaleLowerCase("fr"),
				),
			);
			const missing = DEFAULT_CATEGORIES.filter(
				(category) => !held.has(category.name.toLocaleLowerCase("fr")),
			);
			const now = Date.now();

			if (missing.length > 0) {
				await tx.insert(categories).values(
					missing.map((category) => ({
						id: crypto.randomUUID(),
						...category,
						parentId: null,
						createdAt: now,
						updatedAt: now,
					})),
				);
			}

			return { created: missing.length };
		},
		{ behavior: "immediate" },
	);
}
