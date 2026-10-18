import type { CleanKey, ColumnKey, CsvIssueCode } from "../schemas/csv-imports.ts";
import type { CsvRow } from "./csv-import-format.ts";
import type { Sheet } from "./csv-import-sheet.ts";
import type { SureIssue } from "./sure-import-preflight.ts";

import { COLUMN_KEY_LIST, CSV_ISSUE_CODES, cleanColumnsOf } from "../schemas/csv-imports.ts";
import { RULE_KEYS, ruleCellsOf } from "./csv-import-rules.ts";
import { cellOf, editOf, headerCellOf } from "./csv-import-sheet.ts";
import { categoryOf, rawLabelOf } from "./csv-import-tools.ts";

// Sure's « Nettoyer » at 00dd977fb, `Import::CleansController`: the rows
// `generate_rows_from_csv` made, one value per `column_keys` key, each with
// the refusals of its line on the cell they concern, as `cell_is_valid?`.

/** One refusal on a row, on the cell of its key: an index into `Clean.columns`. */
type CleanIssue = { column: number; issue: SureIssue };

/** One row of the file as « Nettoyer » shows it: its line, its values, its refusals. */
type CleanRow = { line: number; values: string[]; issues: CleanIssue[] };

export type Clean = { columns: CleanKey[]; rows: CleanRow[] };

/** The key a refusal without a `field` concerns. */
const ISSUE_KEYS: Partial<Record<CsvIssueCode, CleanKey>> = {
	invalid_date: "date",
	date_out_of_range: "date",
	invalid_currency: "currency",
	CURRENCY_MISMATCH: "currency",
	too_many_tags: "tags",
	negative_price: "price",
	trade_too_large: "qty",
	security_currency: "ticker",
	own_parent: "category_parent",
	nested_category: "category_parent",
	unsupported_resource_type: "resource_type",
	min_actions: "actions",
	unsupported_rule: "conditions",
};

const isColumnKey = (key: CleanKey): key is ColumnKey =>
	COLUMN_KEY_LIST.some((known) => known === key);

/**
 * A row's value for `key`, what the import reads: the mapped column's cell,
 * YNAB's and Actual's row name and combined category, a category or
 * merchant file's `header_for` column, a rule's normalised cell; each as the
 * user edited it.
 */
function valuesOf(sheet: Sheet, row: CsvRow, columns: readonly CleanKey[]): string[] {
	if (sheet.type === "rules") {
		const cells = ruleCellsOf(row, sheet.lookup, sheet.configuration.separator, (edited, key) =>
			editOf(sheet, edited, key),
		);

		return columns.map((key) => {
			const ruleKey = RULE_KEYS.find((known) => known === key);

			return ruleKey === undefined ? "" : cells[ruleKey];
		});
	}

	return columns.map((key) => {
		if (sheet.type === "categories" || sheet.type === "merchants") {
			return headerCellOf(sheet, row, key);
		}

		if ((sheet.type === "ynab" || sheet.type === "actual") && key === "name") {
			return rawLabelOf(sheet, row);
		}

		if (key === "category") {
			return categoryOf(sheet, row);
		}

		return isColumnKey(key) ? (cellOf(sheet, row, key) ?? "") : "";
	});
}

/**
 * Every row with its values and the refusals of its line, each on the cell
 * of its key; one whose key the import does not show lands on the first.
 * A refusal without a line belongs to the file or to « Mapper ».
 */
export function cleanOf(sheet: Sheet, errors: readonly SureIssue[]): Clean {
	const columns = [...cleanColumnsOf(sheet.type, sheet.configuration.accountId, sheet.qif)];
	const byLine = new Map<string, SureIssue[]>();

	for (const issue of errors) {
		const line = issue.params.line;

		if (line !== undefined) {
			const issues = byLine.get(line) ?? [];

			issues.push(issue);
			byLine.set(line, issues);
		}
	}

	return {
		columns,
		rows: sheet.table.rows.map((row) => ({
			line: row.line,
			values: valuesOf(sheet, row, columns),
			issues: (byLine.get(String(row.line)) ?? []).map((issue) => {
				const code = CSV_ISSUE_CODES.find((known) => known === issue.code);
				const key =
					columns.find((column) => column === issue.params.field) ??
					(code === undefined ? undefined : ISSUE_KEYS[code]);

				return { column: Math.max(0, key === undefined ? 0 : columns.indexOf(key)), issue };
			}),
		})),
	};
}
