import type { ServiceDeps } from "../deps.ts";
import type { SQL, SQLWrapper } from "drizzle-orm";

import { and, inArray, isNotNull, notInArray, or, sql } from "drizzle-orm";
import { QueryBuilder, alias } from "drizzle-orm/sqlite-core";

import { accounts } from "@archant/data/schema/accounts";
import { entries } from "@archant/data/schema/entries";
import { entryKeys } from "@archant/data/schema/entry-keys";
import { rejectedTransfers } from "@archant/data/schema/rejected-transfers";
import { taggings } from "@archant/data/schema/taggings";
import { trades } from "@archant/data/schema/trades";
import { transactions } from "@archant/data/schema/transactions";
import type { LockableField, LockedFields } from "@archant/data/schema/transactions";
import { transfers } from "@archant/data/schema/transfers";
import type { TransferKind, TransferStatus } from "@archant/data/transfer-kinds";

import { AppError } from "../../lib/errors.ts";
import { deleteAttachmentsOf } from "./attachments.ts";

/** Who asked for a write (AD-2). Only `user` locks fields (AD-10). */
export type Origin = "user" | "rule" | "provider" | "sync" | "maintenance";

export type Transaction = Parameters<Parameters<ServiceDeps["db"]["transaction"]>[0]>[0];

/**
 * `current` with `fields` locked at `now` when a user asks, a field already
 * locked taking the new time, as Sure's `lock_attr!`; any other origin
 * changes nothing (AD-10).
 */
export function lockedBy(
	origin: Origin,
	current: LockedFields,
	fields: readonly LockableField[],
	now: number,
): LockedFields {
	return origin === "user"
		? { ...current, ...Object.fromEntries(fields.map((field) => [field, now])) }
		: { ...current };
}

// Nine columns per entry row: 500 rows bind 4 500 parameters, far below the
// cap whatever the table. Epic 1 inserted a statement in one query, which a
// 3 600-line file would have pushed past it.
export const ROWS_PER_INSERT = 500;

// Keys per lookup query; each query also binds the account and the source.
export const KEYS_PER_LOOKUP = 500;

export function chunksOf<Row>(rows: readonly Row[], size: number): Row[][] {
	return Array.from({ length: Math.ceil(rows.length / size) }, (_, index) =>
		rows.slice(index * size, (index + 1) * size),
	);
}

/** Runs `step` on each item strictly in sequence, so a failed step rolls back with nothing else queued. */
export async function oneByOne<Item>(
	items: readonly Item[],
	step: (item: Item) => Promise<unknown>,
): Promise<void> {
	await items.reduce<Promise<unknown>>(
		(pending, item) => pending.then(() => step(item)),
		Promise.resolve(),
	);
}

/** Runs `write` on each chunk strictly in sequence. */
export async function inSequence<Row>(
	rows: readonly Row[],
	size: number,
	write: (chunk: Row[]) => Promise<unknown>,
): Promise<void> {
	await oneByOne(chunksOf(rows, size), write);
}

/** The transfers `ids` sit in, on either side; `ids` may be a subquery. */
export function transferOf(ids: readonly string[] | SQLWrapper): SQL | undefined {
	return or(
		inArray(transfers.outflowTransactionId, ids),
		inArray(transfers.inflowTransactionId, ids),
	);
}

export function invalidField(path: string, code = "invalid_value"): AppError {
	return new AppError("VALIDATION_ERROR", "The request is invalid.", [{ path, code }]);
}

const splitChild = alias(entries, "split_child");

/**
 * The ids of every split parent (AD-20): an entry some entry names as its
 * parent. Not correlated, so SQLite reads `entries_parent_entry` once per
 * query, however many rows the outer query checks against it.
 */
const splitParentIds = new QueryBuilder()
	.select({ id: splitChild.parentEntryId })
	.from(splitChild)
	.where(isNotNull(splitChild.parentEntryId));

/**
 * Leaves split parents out (AD-20): their children carry the money, and the
 * parent, kept for its bank figures and keys, would count it a second time.
 */
export const notSplitParent = notInArray(entries.id, splitParentIds);

/** Whether the entry `id` names is a split parent; for a select or a narrow where. */
export const isSplitParent = (id: SQLWrapper): SQL => inArray(id, splitParentIds);

/** Whether `entries`' row is a split line. */
export const isSplitChild = isNotNull(entries.parentEntryId);

/**
 * Whether `entries`' row is a parent or a child of a split. Spelled out
 * rather than Drizzle's `or`, which is typed as maybe empty.
 */
export const inSplit = sql`(${isSplitChild} or ${isSplitParent(entries.id)})`;

/**
 * Throws `TRANSACTION_SPLIT` when any of `ids` is a parent or a child of a
 * split, or only a child with `isSplitChild` as `role`: only
 * `services/ledger/splits.ts` may move what keeps a split summing to its
 * parent (AD-20).
 */
export async function refuseSplit(
	tx: Pick<Transaction, "select">,
	ids: readonly string[],
	role: SQL = inSplit,
): Promise<void> {
	const row = await tx
		.select({ id: entries.id })
		.from(entries)
		.where(and(inArray(entries.id, [...ids]), role))
		.get();

	if (row !== undefined) {
		throw new AppError("TRANSACTION_SPLIT", "This transaction is part of a split.");
	}
}

// A quantity is canonical decimal text (`decimals.ts`), so its sign reads from
// the text: zero is exactly `'0'`, below zero starts with `-`. The literals
// stay in the query's text, never bound: SQLite proves a partial index
// applies only from it.

/** A quantity other than zero. */
export function quantityNotZero(quantity: SQLWrapper): SQL {
	return sql`${quantity} <> '0'`;
}

/** A quantity above zero. */
export function quantityAboveZero(quantity: SQLWrapper): SQL {
	return sql`(${quantity} <> '0' and ${quantity} not like '-%')`;
}

/**
 * A quantity of zero or below: the `where` of the partial index
 * `holdings_not_held`, word for word.
 */
export function quantityNotAboveZero(quantity: SQLWrapper): SQL {
	return sql`(${quantity} = '0' or ${quantity} like '-%')`;
}

/**
 * Trades that move a quantity: holdings and the held securities drop an
 * income, as Sure's `PortfolioCache` drops a trade of quantity zero.
 */
export const movesQuantity = quantityNotZero(trades.quantity);

/** A trade's security, typed as never null where `movesQuantity` holds: only interest is on cash. */
export const tradedSecurityId = sql<string>`${trades.securityId}`;

/**
 * Deletes the split lines of `parentIds`, before the parents themselves:
 * `parent_entry_id` restricts. A child carries no key (AD-20), only its
 * transfer and rejected pairs, as any transfer side (AD-11), its taggings,
 * its attachments and its detail row; or it is the trade a transaction was
 * converted into (AD-22), whose row goes first. Without its transfer, the
 * other side is a standard transaction again, as Sure's `unsplit!`
 * destroying the child destroys its transfer.
 */
export async function deleteSplitChildren(
	tx: Transaction,
	parentIds: readonly string[],
): Promise<void> {
	const children = () =>
		tx
			.select({ id: entries.id })
			.from(entries)
			.where(inArray(entries.parentEntryId, [...parentIds]));
	await tx.delete(trades).where(inArray(trades.entryId, children()));
	await tx.delete(transfers).where(transferOf(children()));
	await tx.delete(rejectedTransfers).where(rejectedOf(children()));
	await tx.delete(taggings).where(inArray(taggings.transactionId, children()));
	await deleteAttachmentsOf(tx, children());
	await tx.delete(transactions).where(inArray(transactions.entryId, children()));
	await tx.delete(entries).where(inArray(entries.parentEntryId, [...parentIds]));
}

/**
 * Deletes transactions and every row that points at them, in the order their
 * foreign keys allow, split lines first. Without its keys, a line comes back
 * on re-import, as in Sure; without its transfer, the other side is a
 * standard transaction again. The caller recomputes balances.
 */
export async function deleteTransactionRows(
	tx: Transaction,
	ids: readonly string[],
): Promise<void> {
	await deleteSplitChildren(tx, ids);
	await tx.delete(entryKeys).where(inArray(entryKeys.entryId, ids));
	await tx.delete(transfers).where(transferOf(ids));
	await tx.delete(rejectedTransfers).where(rejectedOf(ids));
	await tx.delete(taggings).where(inArray(taggings.transactionId, ids));
	await deleteAttachmentsOf(tx, ids);
	await tx.delete(transactions).where(inArray(transactions.entryId, ids));
	await tx.delete(entries).where(inArray(entries.id, ids));
}

/** Whether the transaction `id` names is already the outflow or the inflow of a transfer. */
export function inTransferSql(id: SQLWrapper): SQL {
	return sql`exists (select 1 from ${transfers} where ${transfers.outflowTransactionId} = ${id} or ${transfers.inflowTransactionId} = ${id})`;
}

export const inAnyTransfer = inTransferSql(entries.id);

/** The rejected pairs `ids` sit in, on either side; `ids` may be a subquery. */
export function rejectedOf(ids: readonly string[] | SQLWrapper): SQL | undefined {
	return or(
		inArray(rejectedTransfers.outflowTransactionId, ids),
		inArray(rejectedTransfers.inflowTransactionId, ids),
	);
}

// A row is the outflow of at most one transfer and the inflow of at most one,
// so a left join on each unique index never repeats it.
export const asOutflow = alias(transfers, "as_outflow");
export const asInflow = alias(transfers, "as_inflow");
export const counterpartEntry = alias(entries, "counterpart_entry");
export const counterpartAccount = alias(accounts, "counterpart_account");
export const counterpartTransaction = alias(transactions, "counterpart_transaction");

export const counterpartIdOf = sql`coalesce(${asOutflow.inflowTransactionId}, ${asInflow.outflowTransactionId})`;

export const transferColumns = {
	transferId: sql<string | null>`coalesce(${asOutflow.id}, ${asInflow.id})`,
	transferKind: sql<TransferKind | null>`coalesce(${asOutflow.kind}, ${asInflow.kind})`,
	transferStatus: sql<TransferStatus | null>`coalesce(${asOutflow.status}, ${asInflow.status})`,
	counterpartTransactionId: counterpartEntry.id,
	counterpartAccountId: counterpartAccount.id,
	counterpartAccountName: counterpartAccount.name,
	counterpartCategoryId: counterpartTransaction.categoryId,
};

export type TransferColumns = {
	transferId: string | null;
	transferKind: TransferKind | null;
	transferStatus: TransferStatus | null;
	counterpartTransactionId: string | null;
	counterpartAccountId: string | null;
	counterpartAccountName: string | null;
	counterpartCategoryId: string | null;
};
