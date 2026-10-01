import type { ServiceDeps } from "../deps.ts";
import type { SQL, SQLWrapper } from "drizzle-orm";

import { inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { accounts } from "@archant/data/schema/accounts";
import { entries } from "@archant/data/schema/entries";
import { entryKeys } from "@archant/data/schema/entry-keys";
import { rejectedTransfers } from "@archant/data/schema/rejected-transfers";
import { taggings } from "@archant/data/schema/taggings";
import { transactions } from "@archant/data/schema/transactions";
import { transfers } from "@archant/data/schema/transfers";
import type { TransferKind } from "@archant/data/transfer-kinds";

import { AppError } from "../../lib/errors.ts";
/** Who asked for a write (AD-2). Only `user` locks fields (AD-10). */
export type Origin = "user" | "rule" | "provider" | "sync" | "maintenance";

export type Transaction = Parameters<Parameters<ServiceDeps["db"]["transaction"]>[0]>[0];

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

/**
 * Deletes transactions and every row that points at them, in the order their
 * foreign keys allow. Without its keys, a line comes back on re-import, as in
 * Sure; without its transfer, the other side is a standard transaction again.
 * The caller recomputes balances.
 */
export async function deleteTransactionRows(
	tx: Transaction,
	ids: readonly string[],
): Promise<void> {
	await tx.delete(entryKeys).where(inArray(entryKeys.entryId, ids));
	await tx.delete(transfers).where(transferOf(ids));
	await tx.delete(rejectedTransfers).where(rejectedOf(ids));
	await tx.delete(taggings).where(inArray(taggings.transactionId, ids));
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

export const counterpartIdOf = sql`coalesce(${asOutflow.inflowTransactionId}, ${asInflow.outflowTransactionId})`;

export const transferColumns = {
	transferId: sql<string | null>`coalesce(${asOutflow.id}, ${asInflow.id})`,
	transferKind: sql<TransferKind | null>`coalesce(${asOutflow.kind}, ${asInflow.kind})`,
	counterpartAccountId: counterpartAccount.id,
	counterpartAccountName: counterpartAccount.name,
};

export type TransferColumns = {
	transferId: string | null;
	transferKind: TransferKind | null;
	counterpartAccountId: string | null;
	counterpartAccountName: string | null;
};
