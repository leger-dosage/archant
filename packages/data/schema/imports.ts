import { sql } from "drizzle-orm";
import { blob, check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { accounts } from "./accounts.ts";
import { inList } from "./check.ts";

/**
 * Connector ids of the file sources (AD-3). The same string is
 * `imports.source` and `entry_keys.source`; CSV and QIF join with their stories.
 */
export const FILE_SOURCE_IDS = ["ofx"] as const;

export type FileSourceId = (typeof FILE_SOURCE_IDS)[number];

export const IMPORT_STATUSES = ["previewed", "confirmed"] as const;

export type ImportStatus = (typeof IMPORT_STATUSES)[number];

/** What a preview offers to change besides writing lines, kept with the file. */
export type ImportOptions = {
	/** The earlier opening date the user accepted, so older lines can go in. */
	moveOpeningDate?: string | undefined;
};

/** How many lines of a confirmed import fell in each group. */
export type ImportCounts = {
	created: number;
	present: number;
	matched: number;
	duplicates: number;
	rejected: number;
};

/**
 * One uploaded file. A `previewed` row keeps the bytes so confirm parses the
 * same file the user saw; rows left unconfirmed for a day are purged at start.
 */
export const imports = sqliteTable(
	"imports",
	{
		id: text("id").primaryKey(),
		accountId: text("account_id")
			.notNull()
			.references(() => accounts.id, { onDelete: "restrict" }),
		source: text("source").$type<FileSourceId>().notNull(),
		fileName: text("file_name").notNull(),
		status: text("status").$type<ImportStatus>().notNull(),
		content: blob("content", { mode: "buffer" }).notNull(),
		options: text("options", { mode: "json" }).$type<ImportOptions>().notNull(),
		// The hash of the last preview's groups; confirm refuses a different one.
		previewDigest: text("preview_digest"),
		counts: text("counts", { mode: "json" }).$type<ImportCounts>(),
		createdAt: integer("created_at").notNull(),
		confirmedAt: integer("confirmed_at"),
	},
	(table) => [
		check("imports_source_check", sql`${table.source} in ${inList(FILE_SOURCE_IDS)}`),
		check("imports_status_check", sql`${table.status} in ${inList(IMPORT_STATUSES)}`),
		index("imports_account").on(table.accountId),
		index("imports_status_created").on(table.status, table.createdAt),
	],
);
