import type { ParsedStatement } from "../domain/statement.ts";

import type { CurrencyCode } from "@archant/data/money";
import type { QifDateOrder } from "@archant/data/qif-options";
import type { CsvMapping, FileSourceId } from "@archant/data/schema/imports";

import { MAX_IMPORT_BYTES } from "../schemas/imports.ts";

/** Checked by every source before parsing, whoever calls it. */
export const MAX_FILE_BYTES = MAX_IMPORT_BYTES;

export type FileSourceOptions = {
	/** The target account's currency: its minor units scale every amount. */
	currency: CurrencyCode;
	/** How to read a CSV file's columns; the other sources ignore it. */
	csv?: CsvMapping | undefined;
	/** How a QIF file's dates read; absent, the parser picks the order that reads them all. */
	qif?: { dateOrder: QifDateOrder } | undefined;
};

/**
 * A file parser behind the connector port (AD-3). It reads bytes, never
 * touches the database, and throws `INVALID_IMPORT_FILE` for a file it
 * cannot read at all; a single unreadable line goes to `rejected` instead.
 */
export type FileSource = {
	id: FileSourceId;
	/** Whether this source reads the file, from its name and first bytes. */
	detect: (bytes: Uint8Array, fileName: string) => boolean;
	parse: (bytes: Uint8Array, options: FileSourceOptions) => ParsedStatement;
};
