import type {
	NormalizedTransaction,
	ParsedStatement,
	RejectionCode,
} from "../../domain/statement.ts";
import type { FileSource, FileSourceOptions } from "../file-source.ts";

import Papa from "papaparse";

import type { CsvDelimiter } from "@archant/data/csv-mapping";
import { CSV_DELIMITERS } from "@archant/data/csv-mapping";
import type { CurrencyCode, MinorUnits } from "@archant/data/money";
import { parseAmount, toMinorUnits } from "@archant/data/money";
import type { CsvMapping } from "@archant/data/schema/imports";

import { providerDate } from "../../domain/provider-date.ts";
import { AppError } from "../../lib/errors.ts";
import { MAX_CSV_SKIP_ROWS } from "../../schemas/imports.ts";
import { LABEL_MAX_LENGTH, NOTES_MAX_LENGTH } from "../../schemas/transactions.ts";
import { decodeText } from "../decode.ts";
import { MAX_FILE_BYTES } from "../file-source.ts";

/**
 * How many of the file's first records the Colonnes step receives: enough to
 * skip the most rows a mapping allows, then show a header and ten rows.
 */
export const SAMPLE_RECORDS = MAX_CSV_SKIP_ROWS + 1 + 10;

// What a first import starts with when papaparse cannot tell: the delimiter
// French banks use, since the comma is their decimal separator.
const FALLBACK_DELIMITER: CsvDelimiter = ";";

function invalidFile(): AppError {
	return new AppError("INVALID_IMPORT_FILE", "The file is not a readable CSV statement.");
}

function text(bytes: Uint8Array): string {
	if (bytes.length > MAX_FILE_BYTES) {
		throw invalidFile();
	}

	return decodeText(bytes);
}

/**
 * Every record of the file, empty ones included, so « Ligne N » points where
 * the user looks: a record's index is its line in the file, unless a quoted
 * cell spans lines before it. An unterminated quote refuses the file, since
 * it swallows every later line into one cell.
 */
function recordsOf(content: string, delimiter: CsvDelimiter): string[][] {
	const { data, errors } = Papa.parse<string[]>(content, { delimiter, skipEmptyLines: false });

	if (errors.some((error) => error.type === "Quotes")) {
		throw invalidFile();
	}

	return data;
}

/**
 * Whether any delimiter splits a record into two fields or more. A text file
 * renamed `.csv` has none, and no mapping could read it.
 */
function isTable(content: string): boolean {
	return CSV_DELIMITERS.some((delimiter) => {
		let found = false;

		Papa.parse<string[]>(content, {
			delimiter,
			step: (row, parser) => {
				if (row.data.length >= 2) {
					found = true;
					parser.abort();
				}
			},
		});

		return found;
	});
}

function isEmpty(record: readonly string[]): boolean {
	return record.every((cell) => cell.trim() === "");
}

/**
 * The delimiter a first import starts with: papaparse's guess among the three
 * a mapping allows, `;` when it cannot tell. Refuses a file with no table.
 */
export function guessDelimiter(bytes: Uint8Array): CsvDelimiter {
	const content = text(bytes);

	if (!isTable(content)) {
		throw invalidFile();
	}

	const { meta, errors } = Papa.parse<string[]>(content, {
		delimitersToGuess: [...CSV_DELIMITERS],
		// Only the delimiter is kept; the guess reads these first records.
		preview: SAMPLE_RECORDS,
	});
	// papaparse reports `,` when it cannot tell, with this error beside it.
	const undetectable = errors.some((error) => error.code === "UndetectableDelimiter");

	return (
		CSV_DELIMITERS.find((delimiter) => !undetectable && delimiter === meta.delimiter) ??
		FALLBACK_DELIMITER
	);
}

/**
 * What the Colonnes step needs: the file's first records as they are, split
 * with `delimiter`, and the widest record after `skipRows`. The interface
 * skips rows and names columns itself, so changing either costs no request.
 */
export function csvLayout(
	bytes: Uint8Array,
	settings: Pick<CsvMapping, "delimiter" | "skipRows">,
): { sample: string[][]; width: number } {
	const records = recordsOf(text(bytes), settings.delimiter);

	return {
		sample: records.slice(0, SAMPLE_RECORDS),
		// A reduce, not a spread: a 5 MB file holds more records than a call's arguments.
		width: records
			.slice(settings.skipRows)
			.reduce((widest, record) => Math.max(widest, record.length), 0),
	};
}

/** Whether every column a mapping reads exists in a file `width` fields wide. */
export function mappingFits(mapping: CsvMapping, width: number): boolean {
	return mapping.columns.every((role, index) => role === "ignore" || index < width);
}

/** The mapping with one role per column of a file `width` fields wide, new ones ignored. */
export function fitMapping(mapping: CsvMapping, width: number): CsvMapping {
	return {
		...mapping,
		columns: Array.from({ length: width }, (_, index) => mapping.columns[index] ?? "ignore"),
	};
}

/** What a first import of a file `width` fields wide starts from, French defaults. */
export function defaultMapping(delimiter: CsvDelimiter, width: number): CsvMapping {
	return {
		delimiter,
		skipRows: 0,
		hasHeader: true,
		dateFormat: "DD/MM/YYYY",
		decimal: ",",
		sign: "inflows-positive",
		columns: Array.from({ length: width }, () => "ignore" as const),
	};
}

const DATE_PATTERNS: Record<CsvMapping["dateFormat"], RegExp> = {
	"DD/MM/YYYY": /^(?<day>\d{1,2})\/(?<month>\d{1,2})\/(?<year>\d{4})$/u,
	"DD/MM/YY": /^(?<day>\d{1,2})\/(?<month>\d{1,2})\/(?<year>\d{2})$/u,
	"DD-MM-YYYY": /^(?<day>\d{1,2})-(?<month>\d{1,2})-(?<year>\d{4})$/u,
	"DD.MM.YYYY": /^(?<day>\d{1,2})\.(?<month>\d{1,2})\.(?<year>\d{4})$/u,
	"YYYY-MM-DD": /^(?<year>\d{4})-(?<month>\d{1,2})-(?<day>\d{1,2})$/u,
	"MM/DD/YYYY": /^(?<month>\d{1,2})\/(?<day>\d{1,2})\/(?<year>\d{4})$/u,
};

/**
 * A cell in the mapping's date format, as `YYYY-MM-DD`; `null` when it is not
 * a real day. A two-digit year is in this century: a bank statement is never
 * from the last one.
 */
export function dateOf(cell: string, format: CsvMapping["dateFormat"]): string | null {
	const groups = DATE_PATTERNS[format].exec(cell.trim())?.groups;

	if (groups === undefined) {
		return null;
	}

	const { year = "", month = "", day = "" } = groups;
	const digits = [year.length === 2 ? `20${year}` : year, month, day]
		.map((part) => part.padStart(2, "0"))
		.join("");

	return providerDate(digits);
}

// Spaces a bank or a spreadsheet puts between thousands, or around a symbol.
// `\s` covers the no-break and narrow no-break spaces of French formatting.
const SPACES = /\s/gu;

function escaped(literal: string): string {
	return literal.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * A signed amount cell in minor units: spaces and a leading or trailing `€`
 * or currency code dropped, the other separator allowed only between groups
 * of three digits, so `12.50` with a decimal comma is refused rather than
 * read as 1 250 euros. `null` when unreadable or empty.
 */
export function amountOf(
	cell: string,
	decimal: CsvMapping["decimal"],
	currency: CurrencyCode,
): MinorUnits | null {
	const symbol = `(?:€|${escaped(currency)})`;
	const compact = cell.replace(SPACES, "").replace(new RegExp(`^${symbol}|${symbol}$`, "iu"), "");
	const group = decimal === "," ? "\\." : ",";
	const match = new RegExp(
		`^([-+−]?)(\\d{1,3}(?:${group}\\d{3})+|\\d+)(?:${escaped(decimal)}(\\d+))?$`,
		"u",
	).exec(compact);

	if (match === null) {
		return null;
	}

	const [, sign = "", integer = "", fraction] = match;
	const digits = integer.replaceAll(decimal === "," ? "." : ",", "");

	return parseAmount(
		`${sign === "+" ? "" : sign}${digits}${fraction === undefined ? "" : `.${fraction}`}`,
		currency,
	);
}

/** The cells of `columns`, cleaned and joined in column order, empty ones dropped. */
function joined(record: readonly string[], columns: readonly number[], limit: number): string {
	const value = columns
		.map((index) => (record[index] ?? "").replace(/\s+/gu, " ").trim())
		.filter((cell) => cell !== "")
		.join(" ");

	// By code points, so an emoji at the limit is never cut in half.
	return Array.from(value).slice(0, limit).join("");
}

type Columns = {
	date: number;
	label: number[];
	notes: number[];
	amount: number | undefined;
	debit: number | undefined;
	credit: number | undefined;
};

function columnsOf(mapping: CsvMapping): Columns {
	const indexes = (role: CsvMapping["columns"][number]) =>
		mapping.columns.flatMap((candidate, index) => (candidate === role ? [index] : []));

	return {
		// The schema guarantees exactly one date column.
		date: indexes("date")[0] ?? -1,
		label: indexes("label"),
		notes: indexes("notes"),
		amount: indexes("amount")[0],
		debit: indexes("debit")[0],
		credit: indexes("credit")[0],
	};
}

function signedAmount(
	record: readonly string[],
	columns: Columns,
	mapping: CsvMapping,
	currency: CurrencyCode,
): MinorUnits | null {
	if (columns.amount !== undefined) {
		const amount = amountOf(record[columns.amount] ?? "", mapping.decimal, currency);

		return amount === null || mapping.sign === "inflows-positive"
			? amount
			: toMinorUnits(0 - amount);
	}

	const debit = columns.debit === undefined ? "" : (record[columns.debit] ?? "").trim();
	const credit = columns.credit === undefined ? "" : (record[columns.credit] ?? "").trim();

	// One of the two, never both: a line that fills both, or neither, is
	// ambiguous, and guessing would put money on the wrong side.
	if ((debit === "") === (credit === "")) {
		return null;
	}

	const amount = amountOf(debit === "" ? credit : debit, mapping.decimal, currency);

	if (amount === null) {
		return null;
	}

	// The column gives the sign, never the cell: banks disagree on whether a
	// debit is printed negative.
	return toMinorUnits(debit === "" ? Math.abs(amount) : -Math.abs(amount));
}

function toLine(
	record: readonly string[],
	columns: Columns,
	mapping: CsvMapping,
	currency: CurrencyCode,
): NormalizedTransaction | RejectionCode {
	const date = dateOf(record[columns.date] ?? "", mapping.dateFormat);

	if (date === null) {
		return "INVALID_DATE";
	}

	const amount = signedAmount(record, columns, mapping, currency);

	if (amount === null) {
		return "INVALID_AMOUNT";
	}

	const label = joined(record, columns.label, LABEL_MAX_LENGTH);

	if (label === "") {
		return "MISSING_LABEL";
	}

	const notes = joined(record, columns.notes, NOTES_MAX_LENGTH);

	return {
		// Keys are the fingerprints (AD-7): no bank column is a stable id.
		externalId: null,
		date,
		amount,
		currency,
		label,
		reference: null,
		notes: notes === "" ? null : notes,
		pending: false,
	};
}

function parse(bytes: Uint8Array, options: FileSourceOptions): ParsedStatement {
	const mapping = options.csv;

	if (mapping === undefined) {
		throw new AppError("VALIDATION_ERROR", "A CSV file needs a column mapping.");
	}

	const content = text(bytes);

	if (!isTable(content)) {
		throw invalidFile();
	}

	const columns = columnsOf(mapping);
	const first = mapping.skipRows + (mapping.hasHeader ? 1 : 0);
	const result: ParsedStatement = { transactions: [], balance: null, rejected: [] };

	for (const [index, record] of recordsOf(content, mapping.delimiter).entries()) {
		if (index < first || isEmpty(record)) {
			continue;
		}

		const mapped = toLine(record, columns, mapping, options.currency);

		if (typeof mapped === "string") {
			// The record's index in the whole file, skipped rows and header included.
			result.rejected.push({ ref: String(index), reason: mapped });
		} else {
			result.transactions.push(mapped);
		}
	}

	return result;
}

/** CSV exports, read through the column mapping the user built for the account. */
export const csvSource: FileSource = {
	id: "csv",
	detect: (_bytes, fileName) => /\.csv$/iu.test(fileName),
	parse,
};
