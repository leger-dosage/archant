import type { AttachmentContentType } from "../attachments.ts";

import { sql } from "drizzle-orm";
import { blob, check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { ATTACHMENT_CONTENT_TYPES } from "../attachments.ts";
import { inList } from "./check.ts";
import { transactions } from "./transactions.ts";

/**
 * A receipt or an invoice attached to a transaction, as Sure's
 * `has_many_attached :attachments`. The bytes live in the database, as
 * `imports.content` does: the `VACUUM INTO` backup and a Turso database then
 * hold them, and the container's root filesystem stays read-only. Only the
 * ledger writes it (AD-2), and it deletes a row's attachments before the row.
 */
export const transactionAttachments = sqliteTable(
	"transaction_attachments",
	{
		id: text("id").primaryKey(),
		// Restrict, not cascade, as the taggings: a delete path that forgets the
		// attachments fails in its tests instead of silently dropping a receipt.
		transactionId: text("transaction_id")
			.notNull()
			.references(() => transactions.entryId, { onDelete: "restrict" }),
		// Cleaned on upload; never a path, never logged.
		filename: text("filename").notNull(),
		// Read from the file's first bytes, never the type the client declared.
		contentType: text("content_type").$type<AttachmentContentType>().notNull(),
		byteSize: integer("byte_size").notNull(),
		createdAt: integer("created_at").notNull(),
		// Last: SQLite reads a row's columns in order, so any column after a
		// 10 MB blob makes every list and export walk the blob's overflow pages.
		content: blob("content", { mode: "buffer" }).notNull(),
	},
	(table) => [
		check(
			"transaction_attachments_content_type_check",
			sql`${table.contentType} in ${inList(ATTACHMENT_CONTENT_TYPES)}`,
		),
		// Every list, count and delete path looks attachments up by transaction.
		index("transaction_attachments_transaction").on(table.transactionId),
	],
);
