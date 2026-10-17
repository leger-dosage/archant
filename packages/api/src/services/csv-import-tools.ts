import type { ColumnKey, ToolImportType } from "../schemas/csv-imports.ts";
import type { CsvRow } from "./csv-import-format.ts";
import type { Sheet } from "./csv-import-sheet.ts";
import type { SureIssue } from "./sure-import-preflight.ts";

import { columnOf, csvIssue, csvValue, plainDecimal, sanitizeNumber } from "./csv-import-format.ts";
import { cellOf, editOf, lineOf, numberOf } from "./csv-import-sheet.ts";

// Sure's `MintImport`, `YnabImport` and `ActualImport` at 00dd977fb: a
// transactions CSV whose columns `DEFAULT_COLUMN_MAPPINGS` already maps, each
// tool reading its amount, its name and its category its own way. What is
// left is `TransactionImport`'s, in `csv-import-transactions.ts`.

/** Sure's `DEFAULT_COLUMN_MAPPINGS`: the date format, and each key's header. */
export const TOOL_PRESETS: Record<
	ToolImportType,
	{ dateFormat: string; columns: Partial<Record<ColumnKey, string>> }
> = {
	mint: {
		dateFormat: "%m/%d/%Y",
		columns: {
			date: "Date",
			name: "Description",
			amount: "Amount",
			currency: "Currency",
			account: "Account Name",
			category: "Category",
			tags: "Labels",
			notes: "Notes",
		},
	},
	ynab: {
		dateFormat: "%m/%d/%Y",
		columns: {
			date: "Date",
			name: "Payee",
			account: "Account",
			category: "Category",
			notes: "Memo",
		},
	},
	actual: {
		dateFormat: "%Y-%m-%d",
		columns: {
			date: "Date",
			name: "Payee",
			amount: "Amount",
			account: "Account",
			category: "Category",
			notes: "Notes",
		},
	},
};

/** Mint's literal type column, Sure's `csv_row["Transaction Type"]`. */
const MINT_TYPE_COLUMN = "Transaction Type";

/** YNAB's literal amount columns, which Sure does not offer to remap. */
const YNAB_AMOUNT_COLUMN = "Amount";
const YNAB_INFLOW_COLUMN = "Inflow";
const YNAB_OUTFLOW_COLUMN = "Outflow";

/** YNAB's category columns: the modern web export's, then YNAB 4's. */
const YNAB_COMBINED_CATEGORY_COLUMN = "Category Group/Category";
const YNAB_CATEGORY_GROUP_COLUMN = "Category Group";
const YNAB_MASTER_CATEGORY_COLUMN = "Master Category";
const YNAB_SUB_CATEGORY_COLUMN = "Sub Category";

/** Actual's category group column. */
const ACTUAL_CATEGORY_GROUP_COLUMN = "Category_Group";

/**
 * One decimal of a row's amount and how it counts: Sure's sum before the
 * signage convention, inflows positive.
 */
export type AmountTerm = { decimal: string; sign: 1 | -1; absolute: boolean };

/** A literal column's cell, as Sure's `csv_value` reads it, trimmed. */
const literal = (sheet: Sheet, row: CsvRow, header: string) =>
	(csvValue(sheet.lookup, row.cells, header) ?? "").trim();

/**
 * A cell that may be blank through `sanitize_number`: `null` when blank,
 * an issue when it reads as no number.
 */
function optionalDecimal(
	sheet: Sheet,
	row: CsvRow,
	header: string,
	errors: SureIssue[],
): string | null | undefined {
	const raw = literal(sheet, row, header);

	if (raw === "") {
		return null;
	}

	const sanitized = sanitizeNumber(raw, sheet.configuration.numberFormat);

	if (sanitized === "") {
		errors.push(csvIssue("invalid_number", { line: lineOf(row), field: "amount" }));

		return undefined;
	}

	return plainDecimal(sanitized);
}

/**
 * Sure's `YnabImport#signed_csv_amount`: a signed `Amount` when the row has
 * one, else `Inflow` minus the absolute `Outflow`, a blank side counting
 * zero; `required` when the file has none of the three columns, so a file
 * that is no YNAB register does not land at zero. An unreadable side is
 * refused where Sure counts it zero.
 */
function ynabTerms(sheet: Sheet, row: CsvRow, errors: SureIssue[]): AmountTerm[] | null {
	const explicit = optionalDecimal(sheet, row, YNAB_AMOUNT_COLUMN, errors);

	if (explicit === undefined) {
		return null;
	}

	if (explicit !== null) {
		return [{ decimal: explicit, sign: 1, absolute: false }];
	}

	const sources = [YNAB_OUTFLOW_COLUMN, YNAB_INFLOW_COLUMN, YNAB_AMOUNT_COLUMN].filter(
		(header) => columnOf(sheet.lookup, header) !== undefined,
	);

	if (sources.length === 0) {
		errors.push(csvIssue("required", { line: lineOf(row), field: "amount" }));

		return null;
	}

	const inflow = optionalDecimal(sheet, row, YNAB_INFLOW_COLUMN, errors);
	// One refusal per line, however many sides do not read.
	const outflow =
		inflow === undefined ? undefined : optionalDecimal(sheet, row, YNAB_OUTFLOW_COLUMN, errors);

	if (inflow === undefined || outflow === undefined) {
		return null;
	}

	return [
		{ decimal: inflow ?? "0", sign: 1, absolute: false },
		{ decimal: outflow ?? "0", sign: -1, absolute: true },
	];
}

/**
 * What a row's amount sums, before the signage convention: the amount
 * column as written; Mint's negated unless its type reads `credit`, as
 * Sure's `MintImport#signed_csv_amount`; YNAB's from its own columns.
 * `null` with an issue on the row's line when it does not read.
 */
export function amountTermsOf(sheet: Sheet, row: CsvRow, errors: SureIssue[]): AmountTerm[] | null {
	if (sheet.type === "ynab") {
		return ynabTerms(sheet, row, errors);
	}

	const decimal = numberOf(sheet, row, "amount", errors);

	if (decimal === null) {
		return null;
	}

	const credit =
		sheet.type !== "mint" || csvValue(sheet.lookup, row.cells, MINT_TYPE_COLUMN) === "credit";

	return [{ decimal, sign: credit ? 1 : -1, absolute: false }];
}

/**
 * A row's label before it is cleaned: its name, else for YNAB and Actual
 * its notes, as their `row_name`; blank leaves Sure's default row name. A
 * name edited in « Nettoyer » is the label.
 */
export function rawLabelOf(sheet: Sheet, row: CsvRow): string {
	const edited = editOf(sheet, row, "name");

	if (edited !== undefined) {
		return edited;
	}

	const name = (cellOf(sheet, row, "name") ?? "").trim();

	return name === "" && (sheet.type === "ynab" || sheet.type === "actual")
		? (cellOf(sheet, row, "notes") ?? "").trim()
		: name;
}

/** Sure's `join_category`: `Group: Category`, or whichever side is not blank. */
function joinCategory(group: string, category: string): string {
	if (group === "") {
		return category;
	}

	return category === "" ? group : `${group}: ${category}`;
}

/**
 * A row's category key, which « Attribuez vos catégories » maps: the
 * category column's cell; YNAB's `combined_category` across its export
 * shapes; Actual's group joined to its category. A joined key reads as
 * `Parent:Child` and files the category under its group. A category edited
 * in « Nettoyer » is the key, as Sure saves the row's combined category.
 */
export function categoryOf(sheet: Sheet, row: CsvRow): string {
	const cell = cellOf(sheet, row, "category") ?? "";

	if (editOf(sheet, row, "category") !== undefined) {
		return cell;
	}

	if (sheet.type === "actual") {
		return joinCategory(literal(sheet, row, ACTUAL_CATEGORY_GROUP_COLUMN), cell.trim());
	}

	if (sheet.type !== "ynab") {
		return cell;
	}

	const combined = literal(sheet, row, YNAB_COMBINED_CATEGORY_COLUMN);

	if (combined !== "") {
		return combined;
	}

	const group = literal(sheet, row, YNAB_CATEGORY_GROUP_COLUMN);

	if (group !== "") {
		return joinCategory(group, cell.trim());
	}

	const master = literal(sheet, row, YNAB_MASTER_CATEGORY_COLUMN);
	const sub = literal(sheet, row, YNAB_SUB_CATEGORY_COLUMN);

	return master !== "" || sub !== "" ? joinCategory(master, sub) : cell.trim();
}
