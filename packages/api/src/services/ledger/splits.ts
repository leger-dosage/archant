import type { ServiceDeps } from "../deps.ts";
import type { EditableRow } from "./patch.ts";
import type { Origin, Transaction } from "./shared.ts";

import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { QueryBuilder, alias } from "drizzle-orm/sqlite-core";

import type { MinorUnits } from "@archant/data/money";
import { entries } from "@archant/data/schema/entries";
import { taggings } from "@archant/data/schema/taggings";
import type { LockableField } from "@archant/data/schema/transactions";
import { transactions } from "@archant/data/schema/transactions";

import { AppError } from "../../lib/errors.ts";
import { MAX_SPLIT_LINES, MAX_TAGS_PER_TRANSACTION } from "../../schemas/transactions.ts";
import { accountWithOpeningDate, recomputeBalances } from "./balances.ts";
import {
	categoryExists,
	categoryOriginOf,
	changeOf,
	detailOf,
	tagsExist,
	transactionRow,
} from "./patch.ts";
import {
	deleteTransactionRows,
	inAnyTransfer,
	invalidField,
	isSplitParent,
	lockedBy,
	oneByOne,
} from "./shared.ts";

const convertedTrade = alias(entries, "converted_trade");

/** The ids of every transaction converted into a trade, its only child (AD-22). */
const convertedIds = new QueryBuilder()
	.select({ id: convertedTrade.parentEntryId })
	.from(convertedTrade)
	.where(and(isNotNull(convertedTrade.parentEntryId), eq(convertedTrade.kind, "trade")));

/** One line of a split, as the split's dialog sends it. */
export type SplitLine = {
	/** A child of this split, updated in place; absent for a new line. */
	id?: string | undefined;
	label: string;
	amount: MinorUnits;
	/** `null` leaves the line « Sans catégorie ». */
	categoryId: string | null;
	/** The whole set. Absent leaves a kept line's tags as they are, and a new line untagged. */
	tagIds?: readonly string[] | undefined;
	/** Absent leaves a kept line's notes as they are, and a new line without. */
	notes?: string | null | undefined;
};

/** A split: its parent and its children, oldest first. */
export type Split = { parentId: string; childIds: string[] };

/**
 * What a split, or a conversion into a trade, reads of the transaction it
 * starts from. `isParent` holds for a converted transaction too, whose only
 * child is its trade; `converted` tells it apart.
 */
export async function splitRow(db: Pick<Transaction, "select">, id: string) {
	const row = await db
		.select({
			id: entries.id,
			accountId: entries.accountId,
			date: entries.date,
			amount: entries.amount,
			currency: entries.currency,
			parentEntryId: entries.parentEntryId,
			isParent: isSplitParent(entries.id).mapWith(Boolean),
			converted: inArray(entries.id, convertedIds).mapWith(Boolean),
			inTransfer: inAnyTransfer.mapWith(Boolean),
			pending: transactions.pending,
			excluded: transactions.excluded,
			oneTime: transactions.oneTime,
			possibleDuplicate: transactions.possibleDuplicate,
			merchantId: transactions.merchantId,
			lockedFields: transactions.lockedFields,
		})
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.where(eq(entries.id, id))
		.get();

	if (row === undefined) {
		throw new AppError("NOT_FOUND", "No transaction has this id.");
	}

	return row;
}

type SplitRow = Awaited<ReturnType<typeof splitRow>>;

/**
 * The parent of the split `id` belongs to, from the parent or a child, as
 * Sure's `resolve_to_parent!`. Throws `NOT_FOUND` for an unknown or an
 * unsplit transaction, a converted one included: its child is a trade.
 */
async function parentOf(db: Pick<Transaction, "select">, id: string): Promise<SplitRow> {
	const row = await splitRow(db, id);

	if (row.parentEntryId !== null) {
		return splitRow(db, row.parentEntryId);
	}

	if (!row.isParent || row.converted) {
		throw new AppError("NOT_FOUND", "This transaction is not split.");
	}

	return row;
}

/** The ids of `parentId`'s children, in the order they were created. */
async function childIdsOf(db: Pick<Transaction, "select">, parentId: string): Promise<string[]> {
	const rows = await db
		.select({ id: entries.id })
		.from(entries)
		.where(eq(entries.parentEntryId, parentId))
		.orderBy(asc(entries.createdAt), asc(entries.id));

	return rows.map((row) => row.id);
}

/**
 * Refuses `lines` for `parent`, before any write: 1 to `MAX_SPLIT_LINES`
 * lines summing exactly to the parent's amount, each id a distinct child of
 * this split, each category and tag known, `MAX_TAGS_PER_TRANSACTION` tags
 * at most. Zero and mixed signs pass, as Sure.
 */
async function checkLines(
	tx: Transaction,
	parent: SplitRow,
	lines: readonly SplitLine[],
	childIds: readonly string[],
): Promise<void> {
	if (lines.length === 0) {
		throw invalidField("lines", "too_small");
	}

	if (lines.length > MAX_SPLIT_LINES) {
		throw invalidField("lines", "too_big");
	}

	if (lines.reduce((total, line) => total + line.amount, 0) !== parent.amount) {
		throw invalidField("lines", "split_sum_mismatch");
	}

	const children = new Set(childIds);

	await oneByOne([...lines.entries()], async ([index, line]) => {
		// Deleted from the set once taken, so the same id twice fails too.
		if (line.id !== undefined && !children.delete(line.id)) {
			throw invalidField(`lines.${index}.id`, "not_a_child");
		}

		if (line.categoryId !== null && !(await categoryExists(tx, line.categoryId))) {
			throw invalidField(`lines.${index}.categoryId`);
		}

		const tagIds = [...new Set(line.tagIds ?? [])];

		if (tagIds.length > MAX_TAGS_PER_TRANSACTION) {
			throw invalidField(`lines.${index}.tagIds`, "too_big");
		}

		if (tagIds.length > 0 && !(await tagsExist(tx, tagIds))) {
			throw invalidField(`lines.${index}.tagIds`);
		}
	});
}

/**
 * Inserts `lines` as children of `parent`: its account, date, currency and
 * merchant, never pending, excluded, flagged, imported or keyed, so no
 * import, sync or revert ever takes one for a bank line (AD-20). A user's
 * line locks what a manual entry locks: its date, amount and label, and its
 * notes, category and tags when set; and its exclusion, which only the split
 * changes, so a rule never excludes a line the user could not include again.
 * One millisecond apart, so they keep the order they came in, as Sure orders
 * them by creation.
 */
async function insertChildren(
	tx: Transaction,
	parent: SplitRow,
	lines: readonly SplitLine[],
	origin: Origin,
	now: number,
): Promise<void> {
	await oneByOne([...lines.entries()], async ([index, line]) => {
		const id = crypto.randomUUID();
		const tagIds = [...new Set(line.tagIds ?? [])];
		const notes = line.notes ?? null;
		const filled: LockableField[] = [
			"date",
			"amount",
			"label",
			"excluded",
			...(notes === null ? [] : ["notes" as const]),
			...(line.categoryId === null ? [] : ["category" as const]),
			...(tagIds.length === 0 ? [] : ["tags" as const]),
		];

		await tx.insert(entries).values({
			id,
			accountId: parent.accountId,
			kind: "transaction",
			date: parent.date,
			amount: line.amount,
			currency: parent.currency,
			parentEntryId: parent.id,
			createdAt: now + index,
			updatedAt: now + index,
		});
		await tx.insert(transactions).values({
			entryId: id,
			label: line.label,
			notes,
			// Sure's `Entry#split!` gives each child the parent's kind, `one_time` included.
			oneTime: parent.oneTime,
			merchantId: parent.merchantId,
			categoryId: line.categoryId,
			categoryOrigin: line.categoryId === null ? null : categoryOriginOf(origin),
			lockedFields: lockedBy(origin, [], filled),
		});

		if (tagIds.length > 0) {
			await tx.insert(taggings).values(tagIds.map((tagId) => ({ transactionId: id, tagId })));
		}
	});
}

/** Updates the kept child `current` to `line`, as `updateTransaction` would, the amount always. */
async function updateChild(
	tx: Transaction,
	current: EditableRow & { id: string },
	line: SplitLine,
	origin: Origin,
	now: number,
): Promise<void> {
	const change = changeOf(
		current,
		{
			label: line.label,
			amount: line.amount,
			notes: line.notes,
			categoryId: line.categoryId,
			tagIds: line.tagIds,
		},
		origin,
	);

	// Written whatever the locks: the sum to the parent's depends on it.
	if (line.amount !== current.amount) {
		await tx
			.update(entries)
			.set({ amount: line.amount, updatedAt: now })
			.where(eq(entries.id, current.id));
	}

	await tx
		.update(transactions)
		.set(detailOf(current, change, origin))
		.where(eq(transactions.entryId, current.id));

	if (change.changed.includes("tags")) {
		await tx.delete(taggings).where(eq(taggings.transactionId, current.id));

		if (change.next.tagIds.length > 0) {
			await tx
				.insert(taggings)
				.values(change.next.tagIds.map((tagId) => ({ transactionId: current.id, tagId })));
		}
	}
}

/** Recomputes the parent's account from its date, as every ledger write does (AD-2). */
async function recompute(deps: ServiceDeps, tx: Transaction, parent: SplitRow): Promise<void> {
	const account = await accountWithOpeningDate(tx, parent.accountId);

	await recomputeBalances(tx, account, parent.date, deps.timeZone);
}

/**
 * The split `id` belongs to, from its parent or one of its children. Throws
 * `NOT_FOUND` for an unknown or an unsplit transaction.
 */
export async function splitOf(deps: ServiceDeps, id: string): Promise<Split> {
	const parent = await parentOf(deps.db, id);

	return { parentId: parent.id, childIds: await childIdsOf(deps.db, parent.id) };
}

/**
 * Splits the transaction `id` into `lines`, as Sure's `Entry#split!` (AD-20):
 * the parent keeps its figures and its keys, is excluded, and a user's split
 * locks that exclusion; each line becomes a child. Throws `NOT_FOUND` for an
 * unknown transaction, `NOT_SPLITTABLE` for a transfer side, a pending,
 * excluded or possibly duplicated transaction, or a split's parent or child,
 * and `VALIDATION_ERROR` on `lines` as `checkLines` says. Balances are
 * recomputed from the parent's date, and do not move.
 */
export async function splitTransaction(
	deps: ServiceDeps,
	id: string,
	lines: readonly SplitLine[],
	options: { origin: Origin },
): Promise<Split> {
	return deps.db.transaction(
		async (tx) => {
			const parent = await splitRow(tx, id);

			if (
				parent.inTransfer ||
				parent.pending ||
				parent.excluded ||
				parent.possibleDuplicate ||
				parent.parentEntryId !== null ||
				parent.isParent
			) {
				throw new AppError("NOT_SPLITTABLE", "This transaction cannot be split.");
			}

			await checkLines(tx, parent, lines, []);
			await insertChildren(tx, parent, lines, options.origin, Date.now());
			await tx
				.update(transactions)
				.set({
					excluded: true,
					lockedFields: lockedBy(options.origin, parent.lockedFields, ["excluded"]),
				})
				.where(eq(transactions.entryId, parent.id));
			await recompute(deps, tx, parent);

			return { parentId: parent.id, childIds: await childIdsOf(tx, parent.id) };
		},
		{ behavior: "immediate" },
	);
}

/**
 * Replaces the lines of the split `id` belongs to, from its parent or a
 * child: a line with the id of a child updates it in place, keeping what it
 * does not send, as AD-17 keeps entry ids; a line without one is a new
 * child; a child no line names is deleted. Sure deletes and recreates every
 * child, losing their tags. Throws `NOT_FOUND` for an unknown or an unsplit
 * transaction, and `VALIDATION_ERROR` on `lines` as `checkLines` says, on
 * `lines.N.id` for an id that is not a child of this split.
 */
export async function editSplit(
	deps: ServiceDeps,
	id: string,
	lines: readonly SplitLine[],
	options: { origin: Origin },
): Promise<Split> {
	return deps.db.transaction(
		async (tx) => {
			const parent = await parentOf(tx, id);
			const childIds = await childIdsOf(tx, parent.id);
			const now = Date.now();

			await checkLines(tx, parent, lines, childIds);

			const kept = lines.flatMap((line) =>
				line.id === undefined ? [] : [{ ...line, id: line.id }],
			);
			const keptIds = new Set(kept.map((line) => line.id));

			await deleteTransactionRows(
				tx,
				childIds.filter((childId) => !keptIds.has(childId)),
			);
			await oneByOne(kept, async (line) => {
				const current = { ...(await transactionRow(tx, line.id)), id: line.id };

				await updateChild(tx, current, line, options.origin, now);
			});
			await insertChildren(
				tx,
				parent,
				lines.filter((line) => line.id === undefined),
				options.origin,
				now,
			);
			await recompute(deps, tx, parent);

			return { parentId: parent.id, childIds: await childIdsOf(tx, parent.id) };
		},
		{ behavior: "immediate" },
	);
}

/**
 * Deletes the children of the split `id` belongs to, from its parent or a
 * child, and counts the parent again, as Sure's `unsplit!`. Its `excluded`
 * stays locked, now `false`: the user set it. Throws `NOT_FOUND` for an
 * unknown or an unsplit transaction. Returns the parent's id.
 */
export async function unsplitTransaction(
	deps: ServiceDeps,
	id: string,
	options: { origin: Origin },
): Promise<string> {
	return deps.db.transaction(
		async (tx) => {
			const parent = await parentOf(tx, id);

			await deleteTransactionRows(tx, await childIdsOf(tx, parent.id));
			await tx
				.update(transactions)
				.set({
					excluded: false,
					lockedFields: lockedBy(options.origin, parent.lockedFields, ["excluded"]),
				})
				.where(eq(transactions.entryId, parent.id));
			await recompute(deps, tx, parent);

			return parent.id;
		},
		{ behavior: "immediate" },
	);
}
