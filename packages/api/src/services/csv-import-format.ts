import type { IsoDate } from "../domain/dates.ts";
import type { CsvIssueCode, CsvSeparator, NumberFormat } from "../schemas/csv-imports.ts";
import type { SureIssue } from "./sure-import-preflight.ts";

import Papa from "papaparse";

import { addDays } from "../domain/dates.ts";
import { DEFAULT_DATE_FORMAT } from "../schemas/csv-imports.ts";
import { issue } from "./sure-import-preflight.ts";

// How Sure's `Import` reads a CSV file at 00dd977fb: `parse_csv_str`,
// `normalize_header`, `csv_value`, `sanitize_number`, the `strptime`
// formats of `Family::DATE_FORMATS` and `detect_date_format`. Pure: no
// database, no clock but the `today` handed in.

/** A refusal of the raw-data imports, its code one the page translates. */
export const csvIssue = (code: CsvIssueCode, params: Record<string, string> = {}): SureIssue =>
	issue(code, params);

/** A data row: its line in the file, the header being line 1, and its trimmed cells. */
export type CsvRow = { line: number; cells: string[] };

export type CsvTable = { headers: string[]; rows: CsvRow[] };

/**
 * The text Archant's export `'`-prefixed so a spreadsheet would not run it as
 * a formula (`textCell` in `services/export.ts`), read back as it was.
 */
const unescapeFormula = (cell: string) => (/^'[=+\-@\t\r]/u.test(cell) ? cell.slice(1) : cell);

/**
 * Sure's `Import.parse_csv_str`: the text trimmed, headers on the first line,
 * every cell trimmed. `null` when the file holds no headers or no data row,
 * or a quote never closes, as Sure's `csv_valid?` refuses it. A blank line
 * is no row: Ruby's reader would give it empty cells every required column
 * then refuses, for no data. `rowsToSkip` drops the file's first lines
 * before, as Sure's `parsed_csv`; a row's line stays its line in the file.
 */
export function parseCsv(text: string, separator: CsvSeparator, rowsToSkip = 0): CsvTable | null {
	const kept =
		rowsToSkip === 0
			? text
			: text
					.split(/(?<=\n)/u)
					.slice(rowsToSkip)
					.join("");
	// Past skipped lines, the blank ones the trim drops before the headers
	// still count: the user counted the file's lines to skip them.
	const blank = rowsToSkip === 0 ? 0 : (/^\s*\n/u.exec(kept)?.[0] ?? "").split("\n").length - 1;
	const parsed = Papa.parse<string[]>(kept.trim(), { delimiter: separator });

	if (parsed.errors.some((error) => error.code === "MissingQuotes")) {
		return null;
	}

	const [header, ...data] = parsed.data;
	const rows = data.flatMap((cells, index): CsvRow[] =>
		cells.every((cell) => cell.trim() === "")
			? []
			: [
					{
						line: rowsToSkip + blank + index + 2,
						cells: cells.map((cell) => unescapeFormula(cell.trim())),
					},
				],
	);

	if (header === undefined || header.every((cell) => cell.trim() === "") || rows.length === 0) {
		return null;
	}

	return { headers: header.map((cell) => cell.trim()), rows };
}

/**
 * Sure's `Import::Row#split_tags`: a list split on `,` when one stands
 * unescaped, else on `|`; a backslash escapes either, or itself. Each name
 * trimmed; a blank cell is one blank name, as Sure's `tags_list`.
 */
export function splitTags(cell: string): string[] {
	if (cell.trim() === "") {
		return [""];
	}

	const unescaped = (delimiter: string) => {
		let escaping = false;

		for (const character of cell) {
			if (escaping) {
				escaping = false;
			} else if (character === "\\") {
				escaping = true;
			} else if (character === delimiter) {
				return true;
			}
		}

		return false;
	};
	const delimiter = unescaped(",") ? "," : unescaped("|") ? "|" : ",";
	const names: string[] = [];
	let current = "";
	let escaping = false;

	for (const character of cell) {
		if (escaping) {
			current += [delimiter, ",", "|", "\\"].includes(character) ? character : `\\${character}`;
			escaping = false;
		} else if (character === "\\") {
			escaping = true;
		} else if (character === delimiter) {
			names.push(current);
			current = "";
		} else {
			current += character;
		}
	}

	names.push(escaping ? `${current}\\` : current);

	return names.map((name) => name.trim());
}

/** Sure's `normalize_header`: trimmed, lower case, `*` removed, spaces and dashes to `_`. */
export function normalizeHeader(header: string): string {
	return header
		.trim()
		.toLowerCase()
		.replaceAll("*", "")
		.replaceAll(/[\s-]+/gu, "_");
}

/** Each normalised header's column, the first of its name, and the headers equal once normalised. */
export type HeaderLookup = { columns: Map<string, number>; duplicates: string[][] };

/** Sure's `normalized_csv_headers`, whose duplicates it refuses as `duplicate_headers`. */
export function headerLookup(headers: readonly string[]): HeaderLookup {
	const groups = new Map<string, { column: number; originals: string[] }>();

	for (const [column, header] of headers.entries()) {
		const normalized = normalizeHeader(header);

		if (normalized === "") {
			continue;
		}

		const group = groups.get(normalized);

		if (group === undefined) {
			groups.set(normalized, { column, originals: [header] });
		} else if (!group.originals.includes(header)) {
			group.originals.push(header);
		}
	}

	return {
		columns: new Map([...groups].map(([normalized, { column }]) => [normalized, column])),
		duplicates: [...groups.values()]
			.map(({ originals }) => originals)
			.filter((originals) => originals.length > 1),
	};
}

/** The column a header or an alias names, as Sure's `header_for`. */
export function columnOf(lookup: HeaderLookup, candidate: string): number | undefined {
	return candidate.trim() === "" ? undefined : lookup.columns.get(normalizeHeader(candidate));
}

/**
 * Sure's `csv_value`: the chosen column's cell, else the first alias
 * column's that is not blank; nothing when no column is chosen.
 */
export function csvValue(
	lookup: HeaderLookup,
	cells: readonly string[],
	label: string | null | undefined,
	...aliases: string[]
): string | undefined {
	if (label === null || label === undefined || label.trim() === "") {
		return undefined;
	}

	for (const candidate of [label, ...aliases]) {
		const column = columnOf(lookup, candidate);
		const value = column === undefined ? undefined : cells[column];

		if (value !== undefined && value.trim() !== "") {
			return value;
		}
	}

	return undefined;
}

const NUMBER_PARTS: Record<NumberFormat, { separator: string; delimiter: string }> = {
	"1,234.56": { separator: ".", delimiter: "," },
	"1.234,56": { separator: ",", delimiter: "." },
	"1 234,56": { separator: ",", delimiter: " " },
	"1,234": { separator: "", delimiter: "," },
};

// No `-`: a Unicode pattern refuses `\-` outside a class, and no format's separator is one.
const escape = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/**
 * Sure's `sanitize_number`: a cell into a plain decimal such as `-1234.56`
 * for the chosen number format, `""` when it does not read as one. The
 * thousands space of « 1 234,56 » may be any Unicode space, and a currency
 * sign only at either end.
 */
export function sanitizeNumber(value: string | undefined, format: NumberFormat): string {
	if (value === undefined) {
		return "";
	}

	const { separator, delimiter } = NUMBER_PARTS[format];
	let sanitized = value.trim();

	if (delimiter === " ") {
		const kept = `\\d${escape(separator)}\\-`;

		sanitized = sanitized
			.replaceAll(/\p{White_Space}/gu, "")
			.replaceAll(new RegExp(`^[^${kept}]+|[^${kept}]+$`, "gu"), "");
	} else {
		sanitized = sanitized
			.replaceAll(new RegExp(`[^\\d${escape(delimiter)}${escape(separator)}\\-]`, "gu"), "")
			.replaceAll(delimiter, "");
	}

	if (separator !== "") {
		sanitized = sanitized.replaceAll(separator, ".");
	}

	return /^-?\d+\.?\d*$/u.test(sanitized) ? sanitized : "";
}

/** A sanitised number as `parseDecimalAmount` and `parseQuantity` read it: `12.` is `12`. */
export const plainDecimal = (sanitized: string) => sanitized.replace(/\.$/u, "");

const MONTHS = [
	"january",
	"february",
	"march",
	"april",
	"may",
	"june",
	"july",
	"august",
	"september",
	"october",
	"november",
	"december",
];

const MONTH_NAME = `(${MONTHS.map((month) => `${month.slice(0, 3)}(?:${month.slice(3)})?`).join("|")})`;

/** Each directive Sure's formats use, as Ruby's `Date._strptime` reads it. */
const DIRECTIVES: Record<string, { pattern: string; part: "year" | "month" | "day" | "short" }> = {
	Y: { pattern: "(\\d{4})", part: "year" },
	y: { pattern: "(\\d{2})", part: "short" },
	m: { pattern: "(\\d{1,2})", part: "month" },
	d: { pattern: "(\\d{1,2})", part: "day" },
	e: { pattern: " ?(\\d{1,2})", part: "day" },
	b: { pattern: MONTH_NAME, part: "month" },
};

type Compiled = { pattern: RegExp; parts: ("year" | "month" | "day" | "short")[] };

const compiled = new Map<string, Compiled>();

function compile(format: string): Compiled {
	const known = compiled.get(format);

	if (known !== undefined) {
		return known;
	}

	const parts: Compiled["parts"] = [];
	let source = "";

	for (let index = 0; index < format.length; index += 1) {
		const character = format.charAt(index);
		const directive = character === "%" ? DIRECTIVES[format.charAt(index + 1)] : undefined;

		if (directive !== undefined) {
			source += directive.pattern;
			parts.push(directive.part);
			index += 1;
		} else {
			// Ruby reads a space in the format as any run of spaces, none included.
			source += character === " " ? "\\s*" : escape(character);
		}
	}

	const result = { pattern: new RegExp(`^${source}$`, "iu"), parts };

	compiled.set(format, result);

	return result;
}

const pad = (value: number, width: number) => String(value).padStart(width, "0");

/**
 * Ruby's `Date.strptime` for Sure's date formats: the day as an ISO date,
 * `null` when the text does not match the format whole or names no real
 * day. A two-digit year is 1969 to 2068, as Ruby's `%y`.
 */
export function strptime(text: string, format: string): IsoDate | null {
	const { pattern, parts } = compile(format);
	const match = pattern.exec(text);

	if (match === null) {
		return null;
	}

	let year = Number.NaN;
	let month = Number.NaN;
	let day = Number.NaN;

	for (const [index, part] of parts.entries()) {
		const value = match[index + 1] ?? "";

		if (part === "year") {
			year = Number(value);
		} else if (part === "short") {
			year = Number(value) + (Number(value) < 69 ? 2000 : 1900);
		} else if (part === "day") {
			day = Number(value);
		} else {
			month = /^\d+$/u.test(value)
				? Number(value)
				: MONTHS.findIndex((name) => name.startsWith(value.slice(0, 3).toLowerCase())) + 1;
		}
	}

	const date = new Date(Date.UTC(year, month - 1, day));

	if (
		Number.isNaN(date.getTime()) ||
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day
	) {
		return null;
	}

	return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** `date` moved `years` years, 29 February becoming the 28th, as Ruby's `years.ago`. */
export function yearsFrom(date: IsoDate, years: number): IsoDate {
	const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
	const target = year + years;
	const last = new Date(Date.UTC(target, month, 0)).getUTCDate();

	return `${pad(target, 4)}-${pad(month, 2)}-${pad(Math.min(day, last), 2)}`;
}

/**
 * Sure's `Import.detect_date_format`: of the candidates, the one reading the
 * most of the first 50 distinct samples, then the most of them between 1970
 * and five years ahead, the earlier candidate on a tie; `fallback` when none
 * reads any, `%Y-%m-%d` unless a QIF file's `%m/%d/%Y`.
 */
export function detectDateFormat(
	samples: readonly string[],
	candidates: readonly string[],
	today: IsoDate,
	fallback = DEFAULT_DATE_FORMAT,
): string {
	const cleaned = [...new Set(samples.filter((sample) => sample.trim() !== ""))].slice(0, 50);
	const latest = yearsFrom(today, 5);
	let best: { format: string; parsed: number; reasonable: number } | null = null;

	for (const format of candidates) {
		const dates = cleaned.map((sample) => strptime(sample, format)).filter((date) => date !== null);
		const reasonable = dates.filter((date) => date >= "1970-01-01" && date <= latest).length;

		if (
			dates.length > 0 &&
			(best === null ||
				dates.length > best.parsed ||
				(dates.length === best.parsed && reasonable > best.reasonable))
		) {
			best = { format, parsed: dates.length, reasonable };
		}
	}

	return best?.format ?? fallback;
}

/**
 * Sure's `Import::Row#date_valid` bounds: a date after today, or 30 years
 * old or more, which `Entry.min_supported_date` refuses, is out of range.
 */
export function dateValidity(date: IsoDate, today: IsoDate): "valid" | "out_of_range" {
	return date > today || date <= yearsFrom(today, -30) ? "out_of_range" : "valid";
}

/** The earliest day `dateValidity` accepts, for the message that names the range. */
export const earliestDate = (today: IsoDate) => addDays(yearsFrom(today, -30), 1);
