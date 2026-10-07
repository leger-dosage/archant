import type { ImportPreview } from "../services/imports.ts";

import { z } from "zod";

import {
	CSV_COLUMN_ROLES,
	CSV_DATE_FORMATS,
	CSV_DECIMALS,
	CSV_DELIMITERS,
	CSV_SIGNS,
} from "@archant/data/csv-mapping";
import type { MinorUnits } from "@archant/data/money";
import { toDecimalString } from "@archant/data/money";
import { QIF_DATE_ORDERS } from "@archant/data/qif-options";

import {
	MAX_ASSISTANT_FILE_BYTES,
	confirmImportInput,
	importBankStatementInput,
	previewImportInput,
} from "../schemas/assistants.ts";
import { confirmImport, createImport, previewImport } from "../services/imports.ts";
import { BANK_TEXT, CREATES, DESTROYS, SETS, decimal, defineTool } from "./tool.ts";

/** As many lines as Sure's `import_bank_statement` previews, in each group here. */
const LINES_PER_GROUP = 5;

/** The records after a mapping's skipped lines and header that a CSV sample shows. */
const SAMPLE_RECORDS = 10;

const countsOutput = z.object({
	created: z.number().int().describe("New transactions confirm writes."),
	present: z
		.number()
		.int()
		.describe("Lines already in the account from a file or a bank: nothing is written."),
	matched: z
		.number()
		.int()
		.describe(
			"Lines paired with a transaction already there, which stays as it is and is linked to the file.",
		),
	duplicates: z
		.number()
		.int()
		.describe(
			"Lines close to two transactions already there: created anyway and flagged for the owner to check.",
		),
	rejected: z.number().int().describe("Lines the account cannot hold or the file could not read."),
});

const lineOutput = z.object({
	date: z.string(),
	name: z.string().describe("The line's label."),
	amount: decimal("The line's amount, negative for money out,"),
});

const rejectedOutput = z.object({
	date: z.string().nullable().describe("null when the file could not read the line."),
	name: z.string().nullable(),
	amount: decimal("The line's amount,").nullable(),
	reason: z
		.string()
		.describe(
			"BEFORE_OPENING_DATE: on or before the account's opening date, see opening_suggestion; DATE_TOO_LATE: more than a year from today; CURRENCY_MISMATCH: another currency than the account's; INVALID_DATE, INVALID_AMOUNT, MISSING_LABEL: unreadable; OPENING_BALANCE: an opening balance line, not imported.",
		),
});

const mappingOutput = z.object({
	delimiter: z.enum(CSV_DELIMITERS),
	skip_rows: z.number().int(),
	has_header: z.boolean(),
	date_format: z.enum(CSV_DATE_FORMATS),
	decimal: z.enum(CSV_DECIMALS),
	sign: z.enum(CSV_SIGNS),
	columns: z.array(z.enum(CSV_COLUMN_ROLES)),
});

const previewOutput = z.object({
	import_id: z.string(),
	filename: z.string(),
	source: z.string().describe('The format read: "ofx", "qif" or "csv".'),
	currency: z.string().describe("The account's currency, every amount here is in it."),
	counts: countsOutput.describe("What confirm_import takes as expected_counts."),
	lines: z
		.object({
			created: z.array(lineOutput),
			present: z.array(lineOutput),
			matched: z.array(lineOutput),
			duplicates: z.array(lineOutput),
			rejected: z.array(rejectedOutput),
		})
		.describe(`Up to ${LINES_PER_GROUP} lines of each group, in the file's order.`),
	opening_suggestion: z
		.string()
		.nullable()
		.describe(
			"The opening date that would let in the lines refused as BEFORE_OPENING_DATE, to pass to preview_import as move_opening_date if the owner agrees; null when none is.",
		),
	opening: z
		.object({ date: z.string(), balance: decimal("The opening balance then") })
		.nullable()
		.describe(
			"The opening date and balance confirm sets, the balance on the current opening date unchanged; null when it stays.",
		),
	statement_balance: z
		.object({
			status: z
				.enum(["recorded", "present", "kept", "skipped"])
				.describe(
					'"recorded": confirm records the file\'s closing balance as a snapshot on its date; "present": that snapshot is there already; "kept": the owner recorded another balance that day, which stays, gap apart; "skipped": not recorded, for reason.',
				),
			date: z.string(),
			balance: decimal("The file's closing balance, as stored: what a liability owes is positive,"),
			recorded: decimal("The balance the owner recorded that day,").optional(),
			gap: decimal("balance minus recorded").optional(),
			reason: z
				.string()
				.optional()
				.describe("BEFORE_OPENING_DATE, DATE_IN_FUTURE or CURRENCY_MISMATCH."),
		})
		.nullable()
		.describe("What confirm does with the file's closing balance; null when the file gives none."),
	csv: z
		.object({
			sample: z
				.array(z.array(z.string()))
				.describe(
					`The file's first records as they are, split with the delimiter in use: the skipped lines, the header and ${SAMPLE_RECORDS} records.`,
				),
			mapping: mappingOutput
				.nullable()
				.describe(
					"The mapping the lines were read with; null when none is yet, and the groups are then empty.",
				),
			saved: z
				.boolean()
				.describe("Whether mapping is the one the account's last CSV import saved."),
			prefill: mappingOutput.describe(
				"The mapping to start from: the one in use, else the account's saved one fitted to the file, else French defaults.",
			),
		})
		.nullable()
		.describe("null for every source but CSV."),
	qif: z
		.object({
			date_order: z.enum(QIF_DATE_ORDERS),
			ambiguous: z
				.boolean()
				.describe("Every date reads both ways: ask the owner which order the bank uses."),
		})
		.nullable()
		.describe("null for every source but QIF."),
});

type PreviewOutput = z.input<typeof previewOutput>;

type CsvMapping = NonNullable<ImportPreview["csv"]>["prefill"];

/** A CSV mapping in the tools' names. */
function mappingOf(mapping: CsvMapping): z.input<typeof mappingOutput> {
	return {
		delimiter: mapping.delimiter,
		skip_rows: mapping.skipRows,
		has_header: mapping.hasHeader,
		date_format: mapping.dateFormat,
		decimal: mapping.decimal,
		sign: mapping.sign,
		columns: mapping.columns,
	};
}

function previewOf(preview: ImportPreview): PreviewOutput {
	const { currency, groups, statementBalance } = preview;
	const money = (amount: MinorUnits) => toDecimalString({ amount, currency });
	const lines = (group: ImportPreview["groups"]["created"]) =>
		group
			.slice(0, LINES_PER_GROUP)
			.map((line) => ({ date: line.date, name: line.label, amount: money(line.amount) }));

	return {
		import_id: preview.id,
		filename: preview.fileName,
		source: preview.source,
		currency,
		counts: {
			created: groups.created.length,
			present: groups.present.length,
			matched: groups.matched.length,
			duplicates: groups.duplicates.length,
			rejected: groups.rejected.length,
		},
		lines: {
			created: lines(groups.created),
			present: lines(groups.present),
			matched: lines(groups.matched),
			duplicates: lines(groups.duplicates),
			rejected: groups.rejected.slice(0, LINES_PER_GROUP).map(({ line, reason }) => ({
				date: line?.date ?? null,
				name: line?.label ?? null,
				amount: line === null ? null : money(line.amount),
				reason,
			})),
		},
		opening_suggestion: preview.openingSuggestion,
		opening:
			preview.opening === null
				? null
				: { date: preview.opening.date, balance: money(preview.opening.balance) },
		statement_balance:
			statementBalance === null
				? null
				: {
						status: statementBalance.status,
						date: statementBalance.date,
						balance: money(statementBalance.balance),
						...(statementBalance.status === "kept"
							? { recorded: money(statementBalance.recorded), gap: money(statementBalance.gap) }
							: {}),
						...(statementBalance.status === "skipped" ? { reason: statementBalance.reason } : {}),
					},
		csv:
			preview.csv === null
				? null
				: {
						sample: preview.csv.sample.slice(
							0,
							preview.csv.prefill.skipRows +
								(preview.csv.prefill.hasHeader ? 1 : 0) +
								SAMPLE_RECORDS,
						),
						mapping: preview.csv.mapping === null ? null : mappingOf(preview.csv.mapping),
						saved: preview.csv.saved,
						prefill: mappingOf(preview.csv.prefill),
					},
		qif:
			preview.qif === null
				? null
				: { date_order: preview.qif.dateOrder, ambiguous: preview.qif.ambiguous },
	};
}

const PREVIEW = `Answers the import's id, the counts of each group, which confirm_import takes, up to ${LINES_PER_GROUP} lines of each, what confirming does with the opening date and the file's closing balance, and for a CSV file a sample of its records with the column mapping; nothing reaches the account until confirm_import.`;

export const importBankStatementTool = defineTool({
	name: "import_bank_statement",
	title: "Import a bank statement",
	description: `Reads a statement file the owner's bank exported, OFX, QIF or CSV, into a preview for one account, as the import dialog does in Archant: the same format detection, the same recognition of lines already there, and for a CSV the column mapping the account's last CSV import saved, when the file has its columns. A CSV with no saved mapping answers empty groups until preview_import gives one. ${PREVIEW} A file above ${MAX_ASSISTANT_FILE_BYTES / 1024 / 1024} MB once decoded, or one no format reads, answers INVALID_IMPORT_FILE; the owner imports a larger file through the dialog. An unconfirmed preview is deleted after 24 hours. ${BANK_TEXT}`,
	scope: "archant:write",
	annotations: CREATES,
	input: importBankStatementInput,
	output: previewOutput,
	run: async (deps, { account_id: accountId, filename, content_base64: bytes }) => {
		const preview = await createImport(
			deps,
			accountId,
			{ name: filename, bytes },
			{ maxBytes: MAX_ASSISTANT_FILE_BYTES },
		);

		// The file is kept with its preview, but no line reaches the account yet.
		return { result: previewOf(preview), changedRows: 0 };
	},
});

export const previewImportTool = defineTool({
	name: "preview_import",
	title: "Preview an import again",
	description: `Reads an import not confirmed yet again with the owner's choices, as the dialog's « Colonnes » and « Aperçu » steps do: a CSV file's column mapping, a QIF file's date order, or moving the account's opening date back to opening_suggestion. ${PREVIEW} A mapping without one date, a label and an amount answers VALIDATION_ERROR on csv.columns; an import already confirmed or unknown, NOT_FOUND. ${BANK_TEXT}`,
	scope: "archant:write",
	annotations: SETS,
	input: previewImportInput,
	output: previewOutput,
	run: async (deps, { import_id: importId, csv, qif, move_opening_date: moveOpeningDate }) => ({
		result: previewOf(
			await previewImport(deps, importId, {
				moveOpeningDate,
				...(csv === undefined
					? {}
					: {
							csv: {
								delimiter: csv.delimiter,
								skipRows: csv.skip_rows,
								hasHeader: csv.has_header,
								dateFormat: csv.date_format,
								decimal: csv.decimal,
								sign: csv.sign,
								columns: csv.columns,
							},
						}),
				...(qif === undefined ? {} : { qif: { dateOrder: qif.date_order } }),
			}),
		),
		changedRows: 0,
	}),
});

export const confirmImportTool = defineTool({
	name: "confirm_import",
	title: "Confirm an import",
	description:
		"Writes a previewed import into its account, as the dialog's « Importer » does: the new lines and the possible duplicates are created, matched lines linked to the file, the closing balance recorded as the preview said, a CSV mapping saved for the account's next CSV file, and recurring payments detected again. expected_counts are the counts of the last preview, as the owner saw them: when the account now gives other groups, it answers IMPORT_PREVIEW_STALE with the counts now and writes nothing; preview again and show the owner. A CSV file with no mapping yet answers VALIDATION_ERROR. The owner can revert the import from the account's « Imports » tab; no tool does.",
	scope: "archant:write",
	annotations: DESTROYS,
	input: confirmImportInput,
	output: z.object({ import_id: z.string(), counts: countsOutput }),
	run: async (deps, { import_id: importId, expected_counts: expectedCounts }) => {
		const { id, counts } = await confirmImport(deps, importId, expectedCounts);

		return {
			result: { import_id: id, counts },
			// Rows written or linked to the file; the lines already present change nothing.
			changedRows: counts.created + counts.duplicates + counts.matched,
		};
	},
});
