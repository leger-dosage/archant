import type { ServiceDeps } from "../deps.ts";
import type { Origin, Transaction } from "./shared.ts";
import type { SQLWrapper } from "drizzle-orm";

import { and, asc, eq, inArray } from "drizzle-orm";

import type { AttachmentContentType } from "@archant/data/attachments";
import { MAX_ATTACHMENTS_PER_TRANSACTION } from "@archant/data/attachments";
import { transactionAttachments } from "@archant/data/schema/transaction-attachments";
import { transactions } from "@archant/data/schema/transactions";

import { AppError } from "../../lib/errors.ts";

/** An attachment as its transaction's sheet lists it, without its bytes. */
export type AttachmentItem = {
	id: string;
	transactionId: string;
	filename: string;
	contentType: AttachmentContentType;
	byteSize: number;
	createdAt: number;
};

/** An attachment with its bytes, as it is served. */
export type AttachmentFile = Pick<AttachmentItem, "filename" | "contentType" | "byteSize"> & {
	content: Buffer;
};

/** A file to attach, its name cleaned and its type read from its bytes by the caller. */
export type NewAttachment = {
	filename: string;
	contentType: AttachmentContentType;
	bytes: Uint8Array;
};

const itemColumns = {
	id: transactionAttachments.id,
	transactionId: transactionAttachments.transactionId,
	filename: transactionAttachments.filename,
	contentType: transactionAttachments.contentType,
	byteSize: transactionAttachments.byteSize,
	createdAt: transactionAttachments.createdAt,
};

const notFound = () => new AppError("NOT_FOUND", "No transaction has this id.");

const attachmentNotFound = () => new AppError("NOT_FOUND", "No attachment has this id.");

/** Throws `NOT_FOUND` unless `id` names a transaction, a split's parent or line included. */
async function requireTransaction(db: Pick<Transaction, "select">, id: string): Promise<void> {
	const row = await db
		.select({ id: transactions.entryId })
		.from(transactions)
		.where(eq(transactions.entryId, id))
		.get();

	if (row === undefined) {
		throw notFound();
	}
}

/**
 * Attaches a file to the transaction `transactionId` and returns it as the
 * list shows it. The count is read in the same immediate transaction as the
 * insert, so two uploads at nine files cannot both pass. No balance moves.
 * Throws `NOT_FOUND` for an unknown transaction, and `VALIDATION_ERROR` on
 * `file` with `attachment_limit` once it holds `MAX_ATTACHMENTS_PER_TRANSACTION`.
 */
export async function addAttachment(
	deps: ServiceDeps,
	transactionId: string,
	file: NewAttachment,
	_options: { origin: Origin },
): Promise<AttachmentItem> {
	return deps.db.transaction(
		async (tx) => {
			await requireTransaction(tx, transactionId);

			// Ten rows at most: reading their ids costs no more than counting them.
			const held = await tx
				.select({ id: transactionAttachments.id })
				.from(transactionAttachments)
				.where(eq(transactionAttachments.transactionId, transactionId));

			if (held.length >= MAX_ATTACHMENTS_PER_TRANSACTION) {
				throw new AppError("VALIDATION_ERROR", "The request is invalid.", [
					{ path: "file", code: "attachment_limit" },
				]);
			}

			const item: AttachmentItem = {
				id: crypto.randomUUID(),
				transactionId,
				filename: file.filename,
				contentType: file.contentType,
				byteSize: file.bytes.byteLength,
				createdAt: Date.now(),
			};

			await tx.insert(transactionAttachments).values({ ...item, content: Buffer.from(file.bytes) });

			return item;
		},
		{ behavior: "immediate" },
	);
}

/**
 * The attachments of the transaction `transactionId`, oldest first: ten at
 * most, so never paginated. Throws `NOT_FOUND` for an unknown transaction.
 */
export async function listAttachments(
	deps: ServiceDeps,
	transactionId: string,
): Promise<AttachmentItem[]> {
	await requireTransaction(deps.db, transactionId);

	return deps.db
		.select(itemColumns)
		.from(transactionAttachments)
		.where(eq(transactionAttachments.transactionId, transactionId))
		.orderBy(asc(transactionAttachments.createdAt), asc(transactionAttachments.id));
}

/** The attachment `attachmentId` of `transactionId` with its bytes; `NOT_FOUND` otherwise. */
export async function readAttachment(
	deps: ServiceDeps,
	transactionId: string,
	attachmentId: string,
): Promise<AttachmentFile> {
	const row = await deps.db
		.select({
			filename: transactionAttachments.filename,
			contentType: transactionAttachments.contentType,
			byteSize: transactionAttachments.byteSize,
			content: transactionAttachments.content,
		})
		.from(transactionAttachments)
		.where(
			and(
				eq(transactionAttachments.id, attachmentId),
				eq(transactionAttachments.transactionId, transactionId),
			),
		)
		.get();

	if (row === undefined) {
		throw attachmentNotFound();
	}

	return row;
}

/**
 * Deletes the attachment `attachmentId` of `transactionId`, as Sure's
 * `purge`. Throws `NOT_FOUND` when that transaction holds no such attachment.
 */
export async function deleteAttachment(
	deps: ServiceDeps,
	transactionId: string,
	attachmentId: string,
	_options: { origin: Origin },
): Promise<void> {
	await deps.db.transaction(
		async (tx) => {
			const deleted = await tx
				.delete(transactionAttachments)
				.where(
					and(
						eq(transactionAttachments.id, attachmentId),
						eq(transactionAttachments.transactionId, transactionId),
					),
				)
				.returning({ id: transactionAttachments.id });

			if (deleted.length === 0) {
				throw attachmentNotFound();
			}
		},
		{ behavior: "immediate" },
	);
}

/**
 * Deletes the attachments of the transactions `ids` names, a list or a
 * subquery, inside a ledger delete and before the rows: their foreign key
 * restricts, as Sure purges a destroyed transaction's.
 */
export async function deleteAttachmentsOf(
	tx: Pick<Transaction, "delete">,
	ids: readonly string[] | SQLWrapper,
): Promise<void> {
	await tx.delete(transactionAttachments).where(inArray(transactionAttachments.transactionId, ids));
}

/**
 * Moves the attachments of `fromId` onto `toId`, inside a merge: a receipt
 * never goes with the duplicate it was attached to. Past the cap if need be,
 * which only an upload checks.
 */
export async function moveAttachments(
	tx: Pick<Transaction, "update">,
	fromId: string,
	toId: string,
): Promise<void> {
	await tx
		.update(transactionAttachments)
		.set({ transactionId: toId })
		.where(eq(transactionAttachments.transactionId, fromId));
}
