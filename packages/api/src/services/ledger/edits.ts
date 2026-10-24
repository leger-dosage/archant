import type { IsoDate } from "../../domain/dates.ts";
import type { ServiceDeps } from "../deps.ts";
import type { TransactionFilter } from "./filter.ts";
import type { EditableRow, TransactionDetail, TransactionPatch, UpdateResult } from "./patch.ts";
import type { Origin, Transaction } from "./shared.ts";
import type { SQL } from "drizzle-orm";

import { and, count, eq, inArray, isNotNull, sql } from "drizzle-orm";

import type { MinorUnits } from "@archant/data/money";
import { entries } from "@archant/data/schema/entries";
import { entryKeys } from "@archant/data/schema/entry-keys";
import { rejectedTransfers } from "@archant/data/schema/rejected-transfers";
import { taggings } from "@archant/data/schema/taggings";
import type { LockableField } from "@archant/data/schema/transactions";
import { transactions } from "@archant/data/schema/transactions";
import { transfers } from "@archant/data/schema/transfers";

import { minDate, today } from "../../domain/dates.ts";
import { isTooFarAhead, rejectionFor } from "../../domain/statement.ts";
import { AppError } from "../../lib/errors.ts";
import { deleteAttachmentsOf } from "./attachments.ts";
import { accountWithOpeningDate, recomputeBalances } from "./balances.ts";
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
	writeKeyOf,
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
import { clearOneTime, sidesOf } from "./transfers.ts";

/** What only `services/ledger/splits.ts` changes on a split's rows (AD-20). */
const SPLIT_FIELDS: ReadonlySet<LockableField> = new Set(["date", "amount", "excluded"]);

/**
 * What a split line takes from the form or its parent and never changes
 * alone, as Sure's drawer disables them on a child (AD-20).
 */
const SPLIT_LINE_FIELDS: ReadonlySet<LockableField> = new Set(["label", "category", "merchant"]);

/** What only classifies a row: written beside the entry, never on it. */
const CLASSIFYING_FIELDS: ReadonlySet<LockableField> = new Set([
	"category",
	"merchant",
	"tags",
	"investmentActivityLabel",
]);

/**
 * Edits a transaction and recomputes its account's balances from the earlier
 * of its old and new dates; a change to the category, the merchant, the
 * tags or the activity label alone touches neither the entry nor the
 * balances. A `user` edit locks every field it changes, clearing the
 * category, the merchant or the activity label included, as in Sure; any
 * other origin leaves locked fields as they are (AD-10). The
 * category's origin is the call's, `null` without a category. Throws
 * `VALIDATION_ERROR` on `categoryId` or `merchantId` for an unknown category
 * or merchant, checked in the same transaction as the write so a concurrent
 * delete cannot slip between them, and `TRANSACTION_SPLIT` for a change of
 * the date, the amount or the exclusion of a split's parent or child, which
 * would break the split's sum or count its money twice, and for a change of
 * a child's label, category or merchant, which Sure's drawer disables
 * (AD-20). A child's tags, notes and one-time flag stay editable.
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

			if (changed.some((field) => SPLIT_LINE_FIELDS.has(field))) {
				await refuseSplit(tx, [entryId], isSplitChild);
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
				{ currency: account.currency, today: today(deps.timeZone) },
			);

			if (reason !== null) {
				return { status: "rejected", reason };
			}

			// Sure's `one_time` kind, written apart: no other origin sets it, so it takes no lock.
			if (patch.oneTime !== undefined && patch.oneTime !== current.oneTime) {
				await tx
					.update(transactions)
					.set({ oneTime: patch.oneTime })
					.where(eq(transactions.entryId, entryId));
			}

			if (changed.length === 0) {
				return { status: "updated" };
			}

			// The category, the merchant, the tags and the activity label live beside
			// the entry and move no balance, so classifying a row does not rewrite a
			// decade of daily balances.
			const touchesEntry = changed.some((field) => !CLASSIFYING_FIELDS.has(field));

			if (touchesEntry) {
				await tx
					.update(entries)
					.set({ date: next.date, amount: next.amount, updatedAt: Date.now() })
					.where(eq(entries.id, entryId));
			}

			// The two sides no longer cancel out, so they stop being one movement.
			// A new date keeps the transfer, as in Sure: the money still moved.
			if (changed.includes("amount")) {
				const deleted = await tx
					.delete(transfers)
					.where(transferOf([entryId]))
					.returning({
						outflowTransactionId: transfers.outflowTransactionId,
						inflowTransactionId: transfers.inflowTransactionId,
					});
				// Sure's `Transfer#destroy!` resets both kinds; a flag this very edit sets stands.
				await clearOneTime(
					tx,
					deleted.flatMap(sidesOf).filter((id) => id !== entryId || patch.oneTime !== true),
				);
			}

			const detail = detailOf(change, options.origin, Date.now());

			// Tags alone, from an origin that locks nothing, leave the row as it is.
			if (Object.keys(detail).length > 0) {
				await tx.update(transactions).set(detail).where(eq(transactions.entryId, entryId));
			}

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
 * What an assistant showed the owner of a transaction it deletes: the
 * deletion goes ahead only while the row still holds them.
 */
export type ShownTransaction = { accountId: string; date: IsoDate; amount: MinorUnits };

/** The row as the deletion read it, and the entries it removed, a split's lines included. */
export type DeleteResult = { row: EditableRow; deletedCount: number };

/** The fields of `shown` the row no longer holds, in the order an assistant names them. */
function changedFrom(current: EditableRow, shown: ShownTransaction): string[] {
	return [
		current.accountId === shown.accountId ? null : "accountId",
		current.date === shown.date ? null : "date",
		current.amount === shown.amount ? null : "amount",
	].filter((field) => field !== null);
}

/**
 * Deletes a transaction for good, as Sure does, and recomputes its account's
 * balances from its date. The rows past the new end go with it, and so do its
 * keys: as in Sure, a sync or an import still listing the line brings it
 * back. A split parent goes with its children; a child alone throws `TRANSACTION_SPLIT`.
 * With `shown`, a row whose account, date or amount differs throws
 * `TRANSACTION_CHANGED` first, read in the same transaction as the delete so
 * a sync booking it at another amount cannot slip between them.
 */
export async function deleteTransaction(
	deps: ServiceDeps,
	entryId: string,
	options: { origin: Origin; shown?: ShownTransaction | undefined },
): Promise<DeleteResult> {
	return deps.db.transaction(
		async (tx) => {
			const current = await transactionRow(tx, entryId);
			const changed = options.shown === undefined ? [] : changedFrom(current, options.shown);

			if (changed.length > 0) {
				throw new AppError(
					"TRANSACTION_CHANGED",
					"The transaction changed since it was shown.",
					undefined,
					{ changed: changed.join(",") },
				);
			}

			const account = await accountWithOpeningDate(tx, current.accountId);

			await refuseSplit(tx, [entryId], isSplitChild);
			const lines = await tx.$count(entries, eq(entries.parentEntryId, entryId));
			await deleteTransactionRows(tx, [entryId]);
			await recomputeBalances(tx, account, current.date, deps.timeZone);

			return { row: current, deletedCount: 1 + lines };
		},
		{ behavior: "immediate" },
	);
}

/**
 * The rows a bulk action applies to: the given ids, or every transaction the
 * list's filter matches, across pages.
 */
export type BulkSelection = { ids: readonly string[] } | { filter: TransactionFilter };

/**
 * What a bulk edit may change, as Sure's `Entry.bulk_update!`; an absent field
 * is left as it is. Nothing clears a category or a merchant: Sure's
 * `compact_blank` reads a blank as absent.
 */
export type BulkPatch = {
	date?: IsoDate | undefined;
	label?: string | undefined;
	notes?: string | undefined;
	categoryId?: string | undefined;
	merchantId?: string | undefined;
	/** The whole set, replacing each row's; `[]` removes every tag. */
	tagIds?: readonly string[] | undefined;
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
				categoryHidden: correlatedTransferSide.uncounted.mapWith(Boolean),
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
 * Sets the date, the label, the notes, the category, the merchant or the tags
 * of every selected row, all or nothing, as Sure's `Entry.bulk_update!`, and
 * returns how many rows the selection matched, unchanged ones included, and
 * how many it changed. A selected split parent is skipped and not matched, as
 * Sure's `excluding_split_parents`; a selected split line takes every field
 * but the date, which stays its parent's (AD-20). Each row follows `updateTransaction`'s
 * rules through `changeOf`, so a `user` edit locks every field it changes
 * (AD-10). An unknown category, merchant or tag, or a date further ahead than
 * any entry may be (`isTooFarAhead`), fails the call on its `patch` field.
 * With `expectedCount`, a selection matching another count, split parents
 * included, throws `BULK_COUNT_STALE` and writes nothing: an assistant read
 * that count, and the owner agreed to it, before the call. A new date keeps
 * every transfer, as `updateTransaction` does, and recomputes each account it
 * touched once, from its earliest old or new date.
 */
export async function bulkUpdateTransactions(
	deps: ServiceDeps,
	selection: BulkSelection,
	patch: BulkPatch,
	options: { origin: Origin; expectedCount?: number | undefined },
): Promise<BulkUpdateResult> {
	return deps.db.transaction(
		async (tx) => {
			const { date, label, notes, categoryId, merchantId } = patch;
			const tagIds = patch.tagIds === undefined ? undefined : [...new Set(patch.tagIds)];

			if (date !== undefined && isTooFarAhead(date, today(deps.timeZone))) {
				throw invalidField("patch.date", "date_too_late");
			}

			if (categoryId !== undefined && !(await categoryExists(tx, categoryId))) {
				throw invalidField("patch.categoryId");
			}

			if (merchantId !== undefined && !(await merchantExists(tx, merchantId))) {
				throw invalidField("patch.merchantId");
			}

			if (tagIds !== undefined && tagIds.length > 0 && !(await tagsExist(tx, tagIds))) {
				throw invalidField("patch.tagIds");
			}

			const selected = await selectedRows(tx, selection);
			// One time for every row, so rows locking the same fields share a write.
			const now = Date.now();

			if (options.expectedCount !== undefined && options.expectedCount !== selected.length) {
				throw new AppError(
					"BULK_COUNT_STALE",
					"The filter now matches another count of transactions than expected.",
					undefined,
					{ count: String(selected.length) },
				);
			}

			// Sure's `excluding_split_parents`: the parent stays as the split left it; only selected lines change.
			const rows = selected.filter((row) => !(row.split && row.parentEntryId === null));
			const tagsOf =
				tagIds === undefined
					? new Map<string, string[]>()
					: await tagIdsByEntry(
							tx,
							rows.map((row) => row.id),
						);
			// Rows whose write is the same share one statement per chunk: the
			// fields are the same for all, only the locks already held differ.
			const writes = new Map<string, { detail: TransactionDetail; ids: string[] }>();
			const moved: string[] = [];
			const earliest = new Map<string, IsoDate>();
			const retagged: string[] = [];
			const newTaggings: { transactionId: string; tagId: string }[] = [];
			let changed = 0;

			for (const { id, categoryHidden, parentEntryId, split: _split, ...row } of rows) {
				const current: EditableRow = { ...row, tagIds: tagsOf.get(id) ?? [] };
				const change = changeOf(
					current,
					{
						// A split line keeps its parent's date, as Sure's `split_child?` (AD-20).
						date: parentEntryId === null ? date : undefined,
						label,
						notes,
						// A transfer side the dashboard does not count has no category to
						// set: it would stay hidden, and come back unasked when the transfer
						// is dissociated. The spent outflow of a loan payment or an
						// investment contribution is counted in its category, so it takes one.
						categoryId: categoryHidden ? undefined : categoryId,
						merchantId,
						tagIds,
					},
					options.origin,
				);

				if (change.changed.length === 0) {
					continue;
				}

				changed += 1;
				const detail = detailOf(change, options.origin, now);
				const key = writeKeyOf(detail, change, options.origin);
				const group = writes.get(key);

				if (group === undefined) {
					writes.set(key, { detail, ids: [id] });
				} else {
					group.ids.push(id);
				}

				if (change.changed.includes("date")) {
					moved.push(id);
					const from = minDate(current.date, change.next.date);
					const known = earliest.get(current.accountId);
					earliest.set(current.accountId, known === undefined ? from : minDate(known, from));
				}

				if (change.changed.includes("tags")) {
					retagged.push(id);
					newTaggings.push(...change.next.tagIds.map((tagId) => ({ transactionId: id, tagId })));
				}
			}

			// Tags alone, from an origin that locks nothing, leave the rows as they are.
			const statements = [...writes.values()]
				.filter(({ detail }) => Object.keys(detail).length > 0)
				.flatMap(({ detail, ids }) =>
					chunksOf(ids, ROWS_PER_INSERT).map((chunk) => ({ detail, chunk })),
				);

			await oneByOne(statements, ({ detail, chunk }) =>
				tx.update(transactions).set(detail).where(inArray(transactions.entryId, chunk)),
			);

			if (date !== undefined) {
				// A new date keeps the transfer, as in Sure: the money still moved.
				await inSequence(moved, ROWS_PER_INSERT, (chunk) =>
					tx.update(entries).set({ date, updatedAt: now }).where(inArray(entries.id, chunk)),
				);
			}

			await inSequence(retagged, ROWS_PER_INSERT, (chunk) =>
				tx.delete(taggings).where(inArray(taggings.transactionId, chunk)),
			);
			await inSequence(newTaggings, ROWS_PER_INSERT, (chunk) => tx.insert(taggings).values(chunk));
			await oneByOne([...earliest], async ([accountId, from]) => {
				const account = await accountWithOpeningDate(tx, accountId);
				await recomputeBalances(tx, account, from, deps.timeZone);
			});

			return { matched: rows.length, changed };
		},
		{ behavior: "immediate" },
	);
}

/**
 * Deletes every selected transaction for good, all or nothing, as
 * `deleteTransaction` does one, and returns
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
 * Clears every lock of a transaction at once, as Sure's `unlock_for_sync!`,
 * so the next sync or rule may update any of its fields again (AD-10). Only
 * the locks go: the category keeps the origin that set it. Throws
 * `NOT_FOUND` for an unknown transaction.
 */
export async function unlockTransaction(deps: ServiceDeps, entryId: string): Promise<void> {
	const updated = await deps.db
		.update(transactions)
		.set({ lockedFields: {} })
		.where(eq(transactions.entryId, entryId))
		.returning({ entryId: transactions.entryId });

	if (updated.length === 0) {
		throw new AppError("NOT_FOUND", "No transaction has this id.");
	}
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
 * Leaves every transaction uncategorised, for Sure's `destroy_all` of
 * categories. Maintenance only, as `recategorise`: a lock stays. Returns how
 * many rows lost their category.
 */
export async function uncategoriseAll(deps: ServiceDeps): Promise<number> {
	const result = await deps.db
		.update(transactions)
		.set({ categoryId: null, categoryOrigin: null })
		.where(isNotNull(transactions.categoryId));

	return result.rowsAffected;
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
