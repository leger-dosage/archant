// The choices of a CSV column mapping, apart from the table that stores it so
// the interface can list them without bundling Drizzle. The mapping's type is
// `CsvMapping` in `schema/imports.ts`.

export const CSV_DELIMITERS = [";", ",", "\t"] as const;

export type CsvDelimiter = (typeof CSV_DELIMITERS)[number];

/** Day-first formats first: French banks print dates that way. */
export const CSV_DATE_FORMATS = [
	"DD/MM/YYYY",
	"DD/MM/YY",
	"DD-MM-YYYY",
	"DD.MM.YYYY",
	"YYYY-MM-DD",
	"MM/DD/YYYY",
] as const;

export type CsvDateFormat = (typeof CSV_DATE_FORMATS)[number];

export const CSV_DECIMALS = [",", "."] as const;

export type CsvDecimal = (typeof CSV_DECIMALS)[number];

/**
 * How a signed amount column reads: `inflows-negative` for the exports that
 * print money coming in as negative, as some card statements do.
 */
export const CSV_SIGNS = ["inflows-positive", "inflows-negative"] as const;

export type CsvSign = (typeof CSV_SIGNS)[number];

export const CSV_COLUMN_ROLES = [
	"date",
	"label",
	"amount",
	"debit",
	"credit",
	"notes",
	"ignore",
] as const;

export type CsvColumnRole = (typeof CSV_COLUMN_ROLES)[number];
