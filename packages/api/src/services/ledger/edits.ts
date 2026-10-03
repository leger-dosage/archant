import type { IsoDate } from "../../domain/dates.ts";
import type { ServiceDeps } from "../deps.ts";
import type { TransactionFilter } from "./filter.ts";
import type { EditableRow, TransactionPatch, UpdateResult } from "./patch.ts";
import type { Origin, Transaction } from "./shared.ts";
import type { SQL } from "drizzle-orm";

import { and, count, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { entries } from "@archant/data/schema/entries";
import { entryKeys } from "@archant/data/schema/entry-keys";
import { rejectedTransfers } from "@archant/data/schema/rejected-transfers";
import { taggings } from "@archant/data/schema/taggings";
import type { LockableField } from "@archant/data/schema/transactions";
import { transactions } from "@archant/data/schema/transactions";
import { transfers } from "@archant/data/schema/transfers";

import { minDate, today } from "../../domain/dates.ts";
import { rejectionFor } from "../../domain/statement.ts";
import { AppError } from "../../lib/errors.ts";
import { MAX_TAGS_PER_TRANSACTION } from "../../schemas/transactions.ts";
import { deleteAttachmentsOf } from "./attachments.ts";
import { accountWithOpeningDate, recomputeBalances } from "./balances.ts";
import { tombstoneBankKeys } from "./entry-keys.ts";
import { correlatedTransferSide, filterCondition } from "./filter.ts";
import {
	categoryExists,
	changeOf,
	detailOf,
	editableColumns,
	merchantExists,
	tagIdsByEntry,
	tagsExist,
	transactionRow,
} from "./patch.ts";
import {
	KEYS_PER_LOOKUP,
	ROWS_PER_INSERT,
	chunksOf,
	deleteSplitChildren,
	deleteTransactionRows,
	inSequence,
	inSplit,
	invalidField,
	isSplitChild,
	oneByOne,
	refuseSplit,
	rejectedOf,
	transferOf,
} from "./shared.ts";

/** What only `services/ledger/splits.ts` changes on a split's rows (AD-20). */
const SPLIT_FIELDS: ReadonlySet<LockableField> = new Set(["date", "amount", "excluded"]);

/**
 * Edits a transaction and recomputes its account's balances from the earlier
 * of its old and new dates; a change to the category or the merchant alone
 * touches neither the entry nor the balances. A `user` edit locks every
 * field it changes, clearing the category or the merchant included, as in
 * Sure; any other origin leaves locked fields as they are (AD-10). The
 * category's origin is the call's, `null` without a category. Throws
 * `VALIDATION_ERROR` on `categoryId` or `merchantId` for an unknown category
 * or merchant, checked in the same transaction as the write so a concurrent
 * delete cannot slip between them, and `TRANSACTION_SPLIT` for a change of
 * the date, the amount or the exclusion of a split's parent or child, which
 * would break the split's sum or count its money twice (AD-20).
 */
export async function updateTransaction(
	deps: ServiceDeps,
	entryId: string,
	patch: TransactionPatch,
	options: { origin: Origin },
): Promise<UpdateResult> {
	return deps.db.transaction(
		async (tx): Promise<UpdateResult> => {
			const current = await transactionRow(tx, entryId);
			const account = await accountWithOpeningDate(tx, current.accountId);
			const change = changeOf(current, patch, options.origin);
			const { next, changed } = change;

			if (changed.some((field) => SPLIT_FIELDS.has(field))) {
				await refuseSplit(tx, [entryId]);
			}

			if (
				changed.includes("category") &&
				next.categoryId !== null &&
				!(await categoryExists(tx, next.categoryId))
			) {
				throw invalidField("categoryId");
			}

			if (
				changed.includes("merchant") &&
				next.merchantId !== null &&
				!(await merchantExists(tx, next.merchantId))
			) {
				throw invalidField("merchantId");
			}

			if (
				changed.includes("tags") &&
				next.tagIds.length > 0 &&
				!(await tagsExist(tx, next.tagIds))
			) {
				throw invalidField("tagIds");
			}

			const reason = rejectionFor(
				{ date: next.date, currency: current.currency },
				{
					openingDate: account.openingDate,
					currency: account.currency,
					today: today(deps.timeZone),
				},
			);

			if (reason !== null) {
				return { status: "rejected", reason };
			}

			if (changed.length === 0) {
				return { status: "updated" };
			}

			// The category, the merchant and the tags live beside the entry and move
			// no balance, so classifying a row does not rewrite a decade of daily balances.
			const touchesEntry = changed.some(
				(field) => field !== "category" && field !== "merchant" && field !== "tags",
			);

			if (touchesEntry) {
				await tx
					.update(entries)
					.set({ date: next.date, amount: next.amount, updatedAt: Date.now() })
					.where(eq(entries.id, entryId));
			}

			// The two sides no longer cancel out, so they stop being one movement.
			// A new date keeps the transfer, as in Sure: the money still moved.
			if (changed.includes("amount")) {
				await tx.delete(transfers).where(transferOf([entryId]));
			}

			await tx
				.update(transactions)
				.set(detailOf(current, change, options.origin))
				.where(eq(transactions.entryId, entryId));

			if (changed.includes("tags")) {
				await tx.delete(taggings).where(eq(taggings.transactionId, entryId));

				if (next.tagIds.length > 0) {
					await tx
						.insert(taggings)
						.values(next.tagIds.map((tagId) => ({ transactionId: entryId, tagId })));
				}
			}

			if (touchesEntry) {
				await recomputeBalances(tx, account, minDate(current.date, next.date), deps.timeZone);
			}

			return { status: "updated" };
		},
		{ behavior: "immediate" },
	);
}

/**
 * Deletes a transaction for good, as Sure does, and recomputes its account's
 * balances from its date. The rows past the new end go with it. Its bank keys
 * stay as tombstones, so the next sync, which rereads the last week, does not
 * bring it back; its file keys go, so re-importing the file does. A split
 * parent goes with its children; a child alone throws `TRANSACTION_SPLIT`.
 */
export async function deleteTransaction(
	deps: ServiceDeps,
	entryId: string,
	_options: { origin: Origin },
): Promise<void> {
	await deps.db.transaction(
		async (tx) => {
			const current = await transactionRow(tx, entryId);
			const account = await accountWithOpeningDate(tx, current.accountId);

			await refuseSplit(tx, [entryId], isSplitChild);
			await tombstoneBankKeys(tx, [entryId], Date.now());
			await deleteTransactionRows(tx, [entryId]);
			await recomputeBalances(tx, account, current.date, deps.timeZone);
		},
		{ behavior: "immediate" },
	);
}

/**
 * The rows a bulk action applies to: the given ids, or every transaction the
 * list's filter matches, across pages.
 */
export type BulkSelection = { ids: readonly string[] } | { filter: TransactionFilter };

/** What a bulk edit may change; an absent field is left as it is. */
export type BulkPatch = {
	/** `null` leaves the rows « Sans catégorie ». */
	categoryId?: string | null | undefined;
	/** `null` leaves the rows « Sans marchand ». */
	merchantId?: string | null | undefined;
	/** Added to each row's tags; a bulk edit never removes one. */
	addTagIds?: readonly string[] | undefined;
	excluded?: boolean | undefined;
};

/**
 * Resolves a selection to its rows once, before any write, so a write never
 * changes which rows match: « Sans catégorie », once categorised, would
 * otherwise lose the rows a later chunk still had to lock. An id naming no
 * transaction fails the call on `ids`.
 */
async function selectedRows(tx: Transaction, selection: BulkSelection) {
	const query = (where: SQL | undefined) =>
		tx
			.select({
				id: entries.id,
				...editableColumns,
				categoryHidden: correlatedTransferSide.is.mapWith(Boolean),
				parentEntryId: entries.parentEntryId,
				split: inSplit.mapWith(Boolean),
			})
			.from(entries)
			.innerJoin(transactions, eq(transactions.entryId, entries.id))
			.where(and(eq(entries.kind, "transaction"), where));

	if ("filter" in selection) {
		const where = filterCondition(selection.filter, correlatedTransferSide);

		return where === null ? [] : query(where);
	}

	const ids = [...new Set(selection.ids)];
	const rows: Awaited<ReturnType<typeof query>> = [];

	await inSequence(ids, KEYS_PER_LOOKUP, async (chunk) => {
		rows.push(...(await query(inArray(entries.id, chunk))));
	});

	if (rows.length !== ids.length) {
		throw invalidField("ids");
	}

	return rows;
}

/** How many rows a bulk edit selected, and how many of them it changed. */
export type BulkUpdateResult = { matched: number; changed: number };

/**
 * Sets a category or a merchant, adds tags or changes the exclusion on every
 * selected row, all or nothing, and returns how many rows the selection
 * matched, unchanged ones included, and how many it changed. Each row follows
 * `updateTransaction`'s rules through `changeOf`. An unknown category,
 * merchant or tag, or a row the new tags would carry past
 * `MAX_TAGS_PER_TRANSACTION`, fails the call on its `patch` field. With
 * `expectedCount`, a selection matching another count throws
 * `BULK_COUNT_STALE` and writes nothing: an assistant read that count, and the
 * owner agreed to it, before the call. A split's rows keep their exclusion,
 * as a locked field: only the split sets it (AD-20). Classification and
 * exclusion move no balance, so nothing is recomputed.
 */
export async function bulkUpdateTransactions(
	deps: ServiceDeps,
	selection: BulkSelection,
	patch: BulkPatch,
	options: { origin: Origin; expectedCount?: number | undefined },
): Promise<BulkUpdateResult> {
	return deps.db.transaction(
		async (tx) => {
			const { categoryId, merchantId, excluded } = patch;
			const added = patch.addTagIds === undefined ? undefined : [...new Set(patch.addTagIds)];

			if (
				categoryId !== undefined &&
				categoryId !== null &&
				!(await categoryExists(tx, categoryId))
			) {
				throw invalidField("patch.categoryId");
			}

			if (
				merchantId !== undefined &&
				merchantId !== null &&
				!(await merchantExists(tx, merchantId))
			) {
				throw invalidField("patch.merchantId");
			}

			if (added !== undefined && added.length > 0 && !(await tagsExist(tx, added))) {
				throw invalidField("patch.addTagIds");
			}

			const rows = await selectedRows(tx, selection);

			if (options.expectedCount !== undefined && options.expectedCount !== rows.length) {
				throw new AppError(
					"BULK_COUNT_STALE",
					"The filter now matches another count of transactions than expected.",
					undefined,
					{ count: String(rows.length) },
				);
			}

			const tagsOf =
				added === undefined
					? new Map<string, string[]>()
					: await tagIdsByEntry(
							tx,
							rows.map((row) => row.id),
						);
			// Rows whose write is the same share one statement per chunk: the
			// classification is the same for all, only the locks already held differ.
			const writes = new Map<
				string,
				{ detail: Partial<typeof transactions.$inferInsert>; ids: string[] }
			>();
			const newTaggings: { transactionId: string; tagId: string }[] = [];
			let changed = 0;

			for (const { id, categoryHidden, parentEntryId: _parent, split, ...row } of rows) {
				const current: EditableRow = { ...row, tagIds: tagsOf.get(id) ?? [] };
				const tagIds =
					added === undefined ? undefined : [...new Set([...current.tagIds, ...added])];

				if (tagIds !== undefined && tagIds.length > MAX_TAGS_PER_TRANSACTION) {
					throw invalidField("patch.addTagIds", "too_big");
				}

				const change = changeOf(
					current,
					// A transfer side the dashboard does not count has no category to
					// set: it would stay hidden, and come back unasked when the transfer
					// is dissociated. The spent outflow of a loan payment or an
					// investment contribution is counted in its category, so it takes one.
					{
						categoryId: categoryHidden ? undefined : categoryId,
						merchantId,
						excluded: split ? undefined : excluded,
						tagIds,
					},
					options.origin,
				);

				if (change.changed.length === 0) {
					continue;
				}

				changed += 1;
				const detail = detailOf(current, change, options.origin);
				const key = JSON.stringify(detail);
				const group = writes.get(key);

				if (group === undefined) {
					writes.set(key, { detail, ids: [id] });
				} else {
					group.ids.push(id);
				}

				if (change.changed.includes("tags")) {
					newTaggings.push(
						...change.next.tagIds
							.filter((tagId) => !current.tagIds.includes(tagId))
							.map((tagId) => ({ transactionId: id, tagId })),
					);
				}
			}

			const statements = [...writes.values()].flatMap(({ detail, ids }) =>
				chunksOf(ids, ROWS_PER_INSERT).map((chunk) => ({ detail, chunk })),
			);

			await oneByOne(statements, ({ detail, chunk }) =>
				tx.update(transactions).set(detail).where(inArray(transactions.entryId, chunk)),
			);
			await inSequence(newTaggings, ROWS_PER_INSERT, (chunk) => tx.insert(taggings).values(chunk));

			return { matched: rows.length, changed };
		},
		{ behavior: "immediate" },
	);
}

/**
 * Deletes every selected transaction for good, all or nothing, as
 * `deleteTransaction` does one, bank keys kept as tombstones, and returns
 * how many went. A selected split parent goes with its children, and a
 * selected child is skipped, as Sure's `bulk_deletions_controller`; neither
 * child counts. Recomputes each affected account once, from its earliest
 * deleted date, as `revertImport` does.
 */
export async function bulkDeleteTransactions(
	deps: ServiceDeps,
	selection: BulkSelection,
	_options: { origin: Origin },
): Promise<number> {
	return deps.db.transaction(
		async (tx) => {
			const rows = (await selectedRows(tx, selection)).filter((row) => row.parentEntryId === null);
			const ids = rows.map((row) => row.id);
			const earliest = new Map<string, IsoDate>();

			for (const row of rows) {
				const known = earliest.get(row.accountId);
				earliest.set(row.accountId, known === undefined ? row.date : minDate(known, row.date));
			}

			const now = Date.now();

			await inSequence(ids, ROWS_PER_INSERT, (chunk) => tombstoneBankKeys(tx, chunk, now));
			await inSequence(ids, ROWS_PER_INSERT, (chunk) => deleteSplitChildren(tx, chunk));
			// The same order as `deleteTransaction`: their foreign keys restrict
			// deleting the entry.
			await inSequence(ids, ROWS_PER_INSERT, (chunk) =>
				tx.delete(entryKeys).where(inArray(entryKeys.entryId, chunk)),
			);
			await inSequence(ids, ROWS_PER_INSERT, (chunk) =>
				tx.delete(taggings).where(inArray(taggings.transactionId, chunk)),
			);
			await inSequence(ids, ROWS_PER_INSERT, (chunk) => deleteAttachmentsOf(tx, chunk));
			await inSequence(ids, ROWS_PER_INSERT, (chunk) =>
				tx.delete(transfers).where(transferOf(chunk)),
			);
			await inSequence(ids, ROWS_PER_INSERT, (chunk) =>
				tx.delete(rejectedTransfers).where(rejectedOf(chunk)),
			);
			await inSequence(ids, ROWS_PER_INSERT, (chunk) =>
				tx.delete(transactions).where(inArray(transactions.entryId, chunk)),
			);
			await inSequence(ids, ROWS_PER_INSERT, (chunk) =>
				tx.delete(entries).where(inArray(entries.id, chunk)),
			);
			await oneByOne([...earliest], async ([accountId, date]) => {
				const account = await accountWithOpeningDate(tx, accountId);
				await recomputeBalances(tx, account, date, deps.timeZone);
			});

			return rows.length;
		},
		{ behavior: "immediate" },
	);
}

/**
 * Moves every transaction of category `from` to `to`, or leaves them
 * uncategorised with `null`, and returns how many moved. Called by a
 * category's delete and merge with `origin: "maintenance"`: the user chose
 * the category, not each transaction, so `locked_fields` and
 * `category_origin` stay as they are (AD-10); only a row left without a
 * category loses its origin, which the database requires. No balance
 * changes, so nothing is recomputed. One statement, whatever the count: a
 * category can hold years of transactions.
 */
export async function recategorise(
	deps: ServiceDeps,
	from: string,
	to: string | null,
	// Maintenance only: a `user` call here would be expected to lock every
	// row it moves, and a category merge must not.
	_options: { origin: "maintenance" },
): Promise<number> {
	return deps.db.transaction(
		async (tx) => {
			const result = await tx
				.update(transactions)
				.set(to === null ? { categoryId: null, categoryOrigin: null } : { categoryId: to })
				.where(eq(transactions.categoryId, from));

			return result.rowsAffected;
		},
		{ behavior: "immediate" },
	);
}

/**
 * How many transactions each category holds, by category id. A category
 * absent from the map holds none. Counted in children and parents alike:
 * rolling children up into their parent is the reports' business (Epic 6).
 */
export async function countByCategory(deps: ServiceDeps): Promise<Map<string, number>> {
	const rows = await deps.db
		.select({
			// Never null: the `where` below leaves uncategorised rows out.
			categoryId: sql<string>`${transactions.categoryId}`,
			count: count(),
		})
		.from(transactions)
		.where(isNotNull(transactions.categoryId))
		.groupBy(transactions.categoryId);

	return new Map(rows.map((row) => [row.categoryId, row.count]));
}

/**
 * Moves every transaction of merchant `from` to `to`, or unlinks them with
 * `null`, and returns how many moved. Serves a merchant's merge and delete
 * with `origin: "maintenance"`: the user chose the merchant, not each
 * transaction, so `locked_fields` stay as they are (AD-10). One statement,
 * whatever the count, as `recategorise`.
 */
export async function moveMerchant(
	deps: ServiceDeps,
	from: string,
	to: string | null,
	// Maintenance only, for the same reason as `recategorise`.
	_options: { origin: "maintenance" },
): Promise<number> {
	return deps.db.transaction(
		async (tx) => {
			const result = await tx
				.update(transactions)
				.set({ merchantId: to })
				.where(eq(transactions.merchantId, from));

			return result.rowsAffected;
		},
		{ behavior: "immediate" },
	);
}

/** How many transactions each merchant holds, by merchant id; absent holds none. */
export async function countByMerchant(deps: ServiceDeps): Promise<Map<string, number>> {
	const rows = await deps.db
		.select({
			// Never null: the `where` below leaves rows without a merchant out.
			merchantId: sql<string>`${transactions.merchantId}`,
			count: count(),
		})
		.from(transactions)
		.where(isNotNull(transactions.merchantId))
		.groupBy(transactions.merchantId);

	return new Map(rows.map((row) => [row.merchantId, row.count]));
}

/**
 * Removes a tag from every transaction that carries it and returns how many
 * lost it. Serves a tag's delete with `origin: "maintenance"`: the user chose
 * the tag, not each transaction, so `locked_fields` stay as they are (AD-10).
 */
export async function removeTag(
	deps: ServiceDeps,
	tagId: string,
	// Maintenance only, for the same reason as `recategorise`.
	_options: { origin: "maintenance" },
): Promise<number> {
	return deps.db.transaction(
		async (tx) => {
			const result = await tx.delete(taggings).where(eq(taggings.tagId, tagId));

			return result.rowsAffected;
		},
		{ behavior: "immediate" },
	);
}

/** How many transactions each tag marks, by tag id; absent marks none. */
export async function countByTag(deps: ServiceDeps): Promise<Map<string, number>> {
	const rows = await deps.db
		.select({ tagId: taggings.tagId, count: count() })
		.from(taggings)
		.groupBy(taggings.tagId);

	return new Map(rows.map((row) => [row.tagId, row.count]));
}
