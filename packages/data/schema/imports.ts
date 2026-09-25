import type {
	CsvColumnRole,
	CsvDateFormat,
	CsvDecimal,
	CsvDelimiter,
	CsvSign,
} from "../csv-mapping.ts";
import type { QifDateOrder } from "../qif-options.ts";

import { sql } from "drizzle-orm";
import { blob, check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { accounts } from "./accounts.ts";
import { inList } from "./check.ts";

/**
 * Connector ids of the file sources (AD-3). The same string is
 * `imports.source` and `entry_keys.source`.
 */
export const FILE_SOURCE_IDS = ["ofx", "csv", "qif"] as const;

export type FileSourceId = (typeof FILE_SOURCE_IDS)[number];

export const IMPORT_STATUSES = ["previewed", "confirmed", "reverted"] as const;

export type ImportStatus = (typeof IMPORT_STATUSES)[number];

/**
 * How to read one bank's CSV export, saved per account (`import_mappings`).
 * Columns are addressed by index, not by header name: many French exports
 * start with account lines, and several have no header at all.
 */
export type CsvMapping = {
	delimiter: CsvDelimiter;
	/** Lines dropped before the header or the first record: an account preamble. */
	skipRows: number;
	hasHeader: boolean;
	dateFormat: CsvDateFormat;
	decimal: CsvDecimal;
	sign: CsvSign;
	/** One role per column, by index. */
	columns: CsvColumnRole[];
};

/** What a preview offers to change besides writing lines, kept with the file. */
export type ImportOptions = {
	/** The earlier opening date the user accepted, so older lines can go in. */
	moveOpeningDate?: string | undefined;
	/** How a CSV file is read; absent for every other source. */
	csv?: CsvMapping | undefined;
	/**
	 * How a QIF file's dates are read, when the user chose; absent, the order
	 * that reads every date wins. Never saved per account: QIF has no header
	 * saying which, so the next file is detected again.
	 */
	qif?: { dateOrder: QifDateOrder } | undefined;
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
		revertedAt: integer("reverted_at"),
		// The opening date before confirm moved the anchor back, written only
		// then. The moved-in lines shifted the anchor's amount; a revert gives
		// back the share of the lines it deletes dated on or before this day,
		// and moves the anchor's date back toward it, as far as the entries
		// still on the account allow.
		previousOpeningDate: text("previous_opening_date"),
	},
	(table) => [
		check("imports_source_check", sql`${table.source} in ${inList(FILE_SOURCE_IDS)}`),
		check("imports_status_check", sql`${table.status} in ${inList(IMPORT_STATUSES)}`),
		index("imports_account").on(table.accountId),
		index("imports_status_created").on(table.status, table.createdAt),
	],
);
