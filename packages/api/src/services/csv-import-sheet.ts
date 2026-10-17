import type { IsoDate } from "../domain/dates.ts";
import type { Logger } from "../lib/logger.ts";
import type {
	AmountTypeStrategy,
	ColumnKey,
	CsvImportType,
	CsvSeparator,
	NumberFormat,
	SignageConvention,
	csvImportConfigurationSchema,
	csvImportMappingsSchema,
} from "../schemas/csv-imports.ts";
import type { CsvRow, CsvTable, HeaderLookup } from "./csv-import-format.ts";
import type { ServiceDeps } from "./deps.ts";
import type { Transaction } from "./ledger/shared.ts";
import type { SureIssue } from "./sure-import-preflight.ts";
import type { z } from "zod";

import type { AccountSubtype, AccountType } from "@archant/data/account-types";
import type { Database } from "@archant/data/client";
import type { CurrencyCode } from "@archant/data/money";
import { isCurrencyCode } from "@archant/data/money";

import { CREATE_NEW_KEY, dateFormatsOf } from "../schemas/csv-imports.ts";
import {
	csvIssue,
	csvValue,
	dateValidity,
	earliestDate,
	plainDecimal,
	sanitizeNumber,
	strptime,
} from "./csv-import-format.ts";

// One CSV file as Sure's `Import` reads it once « Configurer » is applied:
// the choices, each row's cells through them, and the refusals on a line,
// shared by every raw-data import.

/** `$client` too, for the statistics refreshed once lines or trades are committed. */
export type CsvImportDeps = ServiceDeps & { logger: Logger; db: Pick<Database, "$client"> };

export type Configuration = z.output<typeof csvImportConfigurationSchema>;
export type Mappings = z.output<typeof csvImportMappingsSchema>;

/** The choices the preview read the file with: the page's, else Sure's defaults and the file's suggestions. */
export type ResolvedConfiguration = {
	separator: CsvSeparator;
	numberFormat: NumberFormat;
	dateFormat: string;
	signage: SignageConvention;
	/** Sure's `rows_to_skip`, read for a transaction file only. */
	rowsToSkip: number;
	amountTypeStrategy: AmountTypeStrategy;
	amountTypeIdentifier: string | null;
	amountTypeInflow: SignageConvention | null;
	accountId: string | null;
	/** Each column « Configurer » maps, by Sure's key; `null` is « Laisser vide ». */
	columns: Partial<Record<ColumnKey, string | null>>;
};

/** One value of the file, how many rows hold it, and what it maps to; `null` is none yet. */
export type ValueMapping = { key: string; count: number; value: string | null };

export type AccountTypeMapping = {
	key: string;
	count: number;
	type: AccountType | null;
	subtype: AccountSubtype | null;
};

/** « Mapper »: each value of the file with its choice, per Sure's mapping step. */
export type PreviewMappings = {
	accountTypes: AccountTypeMapping[];
	accounts: ValueMapping[];
	categories: ValueMapping[];
	tags: ValueMapping[];
};

/** Sure's aliases of each key, `csv_value`'s fallbacks in `generate_rows_from_csv`. */
export const ALIASES: Record<ColumnKey, readonly string[]> = {
	entity_type: ["entity_type", "account_type", "type"],
	name: ["name"],
	amount: ["amount", "balance"],
	currency: ["currency"],
	date: ["date"],
	qty: ["qty", "quantity"],
	ticker: ["ticker"],
	exchange_operating_mic: ["exchange_operating_mic"],
	price: ["price"],
	account: ["account", "account_name"],
	category: ["category"],
	tags: ["tags"],
	notes: ["notes"],
};

/** One file read: its table, its headers, the choices and the day it is read on. */
export type Sheet = {
	type: CsvImportType;
	/** The uploaded file's name, which an import of transactions keeps in each account's history. */
	fileName: string;
	table: CsvTable;
	lookup: HeaderLookup;
	configuration: ResolvedConfiguration;
	today: IsoDate;
	currency: CurrencyCode;
};

/**
 * What a kind of import reads from a sheet, and how it writes it; `committed`
 * runs once the write is committed, outside its transaction.
 */
export type Analysis = {
	counts: Record<string, number>;
	errors: SureIssue[];
	mappings?: Partial<PreviewMappings>;
	write: (tx: Transaction, deps: ServiceDeps) => Promise<void>;
	committed?: (deps: CsvImportDeps) => Promise<void>;
};

export const nothingToWrite = async () => {};

/**
 * Each value mapped as the page chose, else preselected as Sure's
 * `sync_mappings`: the row `found` names, else « Ajouter comme nouveau »
 * for a value that names something, nothing for a blank one. A choice naming
 * no row offered, or a new row for a value naming nothing, is none.
 */
export function valueMappings(
	keys: readonly { key: string; count: number }[],
	given: Mappings["accounts"],
	offered: ReadonlySet<string>,
	found: (key: string) => string | undefined,
	named: (key: string) => boolean = (key) => key.trim() !== "",
): ValueMapping[] {
	const chosen = new Map((given ?? []).map((mapping) => [mapping.key, mapping.value]));

	return keys.map(({ key, count }) => {
		const value = chosen.has(key)
			? (chosen.get(key) ?? null)
			: (found(key) ?? (named(key) ? CREATE_NEW_KEY : null));
		const valid =
			value !== null && (offered.has(value) || (value === CREATE_NEW_KEY && named(key)));

		return { key, count, value: valid ? value : null };
	});
}

/** A key's cell of a row, as Sure's `csv_value` reads it through the chosen column. */
export const cellOf = (sheet: Sheet, row: CsvRow, key: ColumnKey) =>
	csvValue(sheet.lookup, row.cells, sheet.configuration.columns[key], ...ALIASES[key]);

export const lineOf = (row: CsvRow) => String(row.line);

/** The date label « Format des dates » shows for a `strptime` format. */
const dateLabelOf = (sheet: Sheet) =>
	dateFormatsOf(sheet.type).find(([, format]) => format === sheet.configuration.dateFormat)?.[0] ??
	sheet.configuration.dateFormat;

/**
 * A row's date as Sure's `Import::Row#date_valid` checks it: `null` and an
 * issue when it does not read with the chosen format or falls out of range.
 */
export function dateOf(
	sheet: Sheet,
	row: CsvRow,
	text: string,
	errors: SureIssue[],
): IsoDate | null {
	const date = strptime(text, sheet.configuration.dateFormat);

	if (date === null) {
		errors.push(csvIssue("invalid_date", { line: lineOf(row), format: dateLabelOf(sheet) }));

		return null;
	}

	if (dateValidity(date, sheet.today) === "out_of_range") {
		errors.push(
			csvIssue("date_out_of_range", {
				line: lineOf(row),
				min: earliestDate(sheet.today),
				max: sheet.today,
			}),
		);

		return null;
	}

	return date;
}

/**
 * A required cell of a row through `sanitize_number`: an issue when it is
 * blank (`required`) or reads as no number (`invalid_number`).
 */
export function numberOf(
	sheet: Sheet,
	row: CsvRow,
	key: ColumnKey,
	errors: SureIssue[],
): string | null {
	const raw = cellOf(sheet, row, key);

	if (raw === undefined || raw.trim() === "") {
		errors.push(csvIssue("required", { line: lineOf(row), field: key }));

		return null;
	}

	const sanitized = sanitizeNumber(raw, sheet.configuration.numberFormat);

	if (sanitized === "") {
		errors.push(csvIssue("invalid_number", { line: lineOf(row), field: key }));

		return null;
	}

	return plainDecimal(sanitized);
}

/** A currency cell, Sure's default when blank, refused unless ISO 4217 knows it. */
export function currencyOf(
	sheet: Sheet,
	row: CsvRow,
	fallback: CurrencyCode | null,
	errors: SureIssue[],
): CurrencyCode | null {
	const given = cellOf(sheet, row, "currency")?.trim().toUpperCase();

	if (given === undefined || given === "") {
		return fallback;
	}

	if (!isCurrencyCode(given)) {
		errors.push(csvIssue("invalid_currency", { line: lineOf(row), value: given }));

		return null;
	}

	return given;
}

/** Distinct values with their row counts, sorted by key as Sure lists its mappings. */
export function keysOf(values: readonly string[]): { key: string; count: number }[] {
	const counts = new Map<string, number>();

	for (const value of values) {
		counts.set(value, (counts.get(value) ?? 0) + 1);
	}

	return [...counts]
		.map(([key, count]) => ({ key, count }))
		.toSorted((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
