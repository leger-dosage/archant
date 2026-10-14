import { z } from "zod";

import { CSV_COLUMN_ROLES } from "@archant/data/csv-mapping";
import { QIF_DATE_ORDERS } from "@archant/data/qif-options";

import { MAX_CSV_COLUMNS, csvMappingSchema, isCsvColumnsValid } from "../imports.ts";
import { accountId } from "./fields.ts";

/**
 * The largest file an assistant sends, decoded: a long statement in a call
 * an assistant can still write, and a fifth of the dialog's 5 MB, since the
 * file crosses `/api/mcp` as base64 inside JSON. A larger one goes through
 * the dialog.
 */
export const MAX_ASSISTANT_FILE_BYTES = 1024 * 1024;

/**
 * `import_statement_file`: the dialog's upload, the file in Sure's
 * `upload_account_statement` shape, the account required. Not Sure's
 * `import_bank_statement`, which reads a PDF already uploaded, though it
 * answers its keys. Base64 only, as Sure's: a text field
 * would lose the encoding of a Windows-1252 export.
 */
export const importStatementFileInput = z.strictObject({
	account_id: accountId.describe("The account the statement is for, an id from get_accounts."),
	filename: z
		.string()
		.trim()
		.min(1)
		.max(255)
		.describe(
			'The file\'s name with its extension, such as "releve.ofx": .ofx, .qfx, .qif or .csv, which helps tell the format.',
		),
	content_base64: z
		.base64()
		.transform((content) => new Uint8Array(Buffer.from(content, "base64")))
		.describe(
			`The file's raw bytes, base64-encoded, exactly as the bank exported them: at most ${MAX_ASSISTANT_FILE_BYTES / 1024 / 1024} MB once decoded.`,
		),
});

const importId = z
	.string()
	.min(1)
	.describe("The import_id import_statement_file gave, of an import not confirmed yet.");

/**
 * A CSV column mapping as `preview_import` takes it: the dialog's « Colonnes »
 * step, each choice a closed enum that says what it reads.
 */
const mappingField = csvMappingSchema.shape;

const csvMappingInput = z
	.strictObject({
		delimiter: mappingField.delimiter.describe('The character between fields: ";", "," or a tab.'),
		skip_rows: mappingField.skipRows.describe(
			"Lines dropped at the top before the header or the first record: an account preamble.",
		),
		has_header: mappingField.hasHeader.describe(
			"Whether the first record after the skipped lines names the columns.",
		),
		date_format: mappingField.dateFormat.describe(
			"How the date column reads: DD day, MM month, YY or YYYY year.",
		),
		decimal: mappingField.decimal.describe(
			'The decimal separator of amounts: "," for 1 234,56, "." for 1,234.56.',
		),
		sign: mappingField.sign.describe(
			'How a signed amount column reads: "inflows-positive" when money in is positive, "inflows-negative" when money in is negative, as some card exports print it. Ignored with debit and credit columns.',
		),
		columns: z
			.array(
				z
					.enum(CSV_COLUMN_ROLES)
					.describe(
						'"date"; "label", several joined; "amount", one signed column; "debit" and "credit", unsigned money out and money in, instead of amount; "notes"; "ignore".',
					),
			)
			.max(MAX_CSV_COLUMNS)
			.describe(
				"One role per column, in the file's order: exactly one date, at least one label, and one amount or a debit and a credit column.",
			),
	})
	// The dialog's check, under the same path and code.
	.refine((mapping) => isCsvColumnsValid(mapping.columns), {
		path: ["columns"],
		message: "invalid_columns",
	});

/** `preview_import`: the dialog's « Colonnes » and « Aperçu » choices, through `previewImport`. */
export const previewImportInput = z.strictObject({
	import_id: importId,
	csv: csvMappingInput
		.optional()
		.describe("A CSV file's column mapping; absent, the one in use stays."),
	qif: z
		.strictObject({
			date_order: z
				.enum(QIF_DATE_ORDERS)
				.describe('"day-first" reads 03/04/2026 as 3 April, "month-first" as 4 March.'),
		})
		.optional()
		.describe("A QIF file's date order; absent, the one in use stays."),
});

/** `confirm_import`: the import and the counts of the preview the owner agreed to. */
export const confirmImportInput = z.strictObject({
	import_id: importId,
	expected_counts: z
		.strictObject({
			created: z.number().int().min(0),
			present: z.number().int().min(0),
			matched: z.number().int().min(0),
			duplicates: z.number().int().min(0),
			rejected: z.number().int().min(0),
		})
		.describe(
			"The counts of the last preview, as shown to the owner: nothing is written if the account now gives others.",
		),
});
