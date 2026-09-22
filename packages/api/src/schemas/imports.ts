import { z } from "zod";

import type { CsvColumnRole } from "@archant/data/csv-mapping";
import {
	CSV_COLUMN_ROLES,
	CSV_DATE_FORMATS,
	CSV_DECIMALS,
	CSV_DELIMITERS,
	CSV_SIGNS,
} from "@archant/data/csv-mapping";
import type { CsvMapping } from "@archant/data/schema/imports";

import { EARLIEST_OPENING_DATE } from "./accounts.ts";

/**
 * The largest file an import accepts: far above a decade of a household's
 * statements, and a hard stop before `ofx-js`, whose SGML conversion slows
 * down exponentially on long tag names.
 */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

// A multipart body carries its boundaries and headers besides the file; the
// file's own size is checked against MAX_IMPORT_BYTES after parsing.
export const MAX_IMPORT_BODY_BYTES = MAX_IMPORT_BYTES + 64 * 1024;

/** `multipart/form-data` with one `file` field (AD-15). */
export const importUploadSchema = z.object({ file: z.instanceof(File) });

/** Far wider than any bank export, and a bound on what one request makes the server hold. */
export const MAX_CSV_COLUMNS = 100;

export const MAX_CSV_SKIP_ROWS = 50;

/**
 * Whether the roles make a readable line: exactly one date, a label, and
 * either one signed amount, or a debit column, a credit column or both,
 * never mixed with an amount. The interface disables confirm on the same test.
 */
export function isCsvColumnsValid(columns: readonly CsvColumnRole[]): boolean {
	const count = (role: CsvColumnRole) => columns.filter((candidate) => candidate === role).length;
	const debits = count("debit");
	const credits = count("credit");
	const amounts =
		count("amount") === 1
			? debits + credits === 0
			: count("amount") === 0 && debits <= 1 && credits <= 1 && debits + credits >= 1;

	return count("date") === 1 && count("label") >= 1 && amounts;
}

export const csvMappingSchema = z
	.object({
		delimiter: z.enum(CSV_DELIMITERS),
		skipRows: z.number().int().min(0).max(MAX_CSV_SKIP_ROWS),
		hasHeader: z.boolean(),
		dateFormat: z.enum(CSV_DATE_FORMATS),
		decimal: z.enum(CSV_DECIMALS),
		sign: z.enum(CSV_SIGNS),
		columns: z.array(z.enum(CSV_COLUMN_ROLES)).max(MAX_CSV_COLUMNS),
	})
	.refine((mapping) => isCsvColumnsValid(mapping.columns), {
		path: ["columns"],
		message: "invalid_columns",
	}) satisfies z.ZodType<CsvMapping>;

/**
 * A new preview of a stored import. `moveOpeningDate` accepts the offer to
 * move the account's opening date back; `null` withdraws it. `csv` is the
 * column mapping to read a CSV file with; absent, the stored one stays.
 */
export const importPreviewSchema = z.object({
	// As at account creation: an opening in year 1 would write a balance row
	// for every day since.
	moveOpeningDate: z.iso
		.date()
		.refine((date) => date >= EARLIEST_OPENING_DATE, "date_too_early")
		.nullable(),
	csv: csvMappingSchema.optional(),
});

export type ImportPreviewInput = z.input<typeof importPreviewSchema>;
