import { describe, expect, it } from "vitest";

import {
	csvValue,
	dateValidity,
	detectDateFormat,
	headerLookup,
	normalizeHeader,
	parseCsv,
	sanitizeNumber,
	strptime,
} from "./csv-import-format.ts";

describe("parseCsv", () => {
	it("reads Sure's `parse_csv_str`: trimmed text, headers, every cell trimmed", () => {
		expect(parseCsv("\n  name , color \n Food ,#f97316\n\n", ",")).toEqual({
			headers: ["name", "color"],
			rows: [{ line: 2, cells: ["Food", "#f97316"] }],
		});
	});

	it("splits on the chosen separator, quotes kept as CSV quotes them", () => {
		expect(parseCsv('a;b\n"1;5";"x ""y"""', ";")?.rows).toEqual([
			{ line: 2, cells: ["1;5", 'x "y"'] },
		]);
	});

	it("skips a blank line, the line numbers kept", () => {
		expect(parseCsv("a\n1\n\n2", ",")?.rows).toEqual([
			{ line: 2, cells: ["1"] },
			{ line: 4, cells: ["2"] },
		]);
	});

	it.each([
		["", "nothing"],
		["a,b", "headers only"],
		['a\n"1', "an unclosed quote"],
	])("refuses %j, %s", (text) => {
		expect(parseCsv(text, ",")).toBeNull();
	});
});

describe("headers", () => {
	it("normalises as Sure's `normalize_header`", () => {
		expect(normalizeHeader(" Account Type* ")).toBe("account_type");
		expect(normalizeHeader("Balance-Date")).toBe("balance_date");
	});

	it("names the headers equal once normalised", () => {
		expect(headerLookup(["Name", "name*", "Color"]).duplicates).toEqual([["Name", "name*"]]);
	});

	it("reads a column, then Sure's aliases, as `csv_value`", () => {
		const lookup = headerLookup(["Type", "Account Type", "Balance"]);

		expect(csvValue(lookup, ["", "Depository", "10"], "Type", "entity_type", "account_type")).toBe(
			"Depository",
		);
		expect(csvValue(lookup, ["Loan", "", "10"], "Type", "entity_type", "account_type")).toBe(
			"Loan",
		);
		expect(csvValue(lookup, ["Loan", "", "10"], null, "entity_type")).toBeUndefined();
	});
});

describe("sanitizeNumber", () => {
	it.each([
		["1,234.56", "1,234.56", "1234.56"],
		["1,234.56", "-$1,234.56", "-1234.56"],
		["1.234,56", "1.234,56 €", "1234.56"],
		["1 234,56", "1 234,56", "1234.56"],
		["1 234,56", "€1 234,56", "1234.56"],
		["1 234,56", "-1 234,5 kr", "-1234.5"],
		["1 234,56", "1,234.56", ""],
		["1,234", "1,234", "1234"],
		["1,234", "12.50", "1250"],
		["1,234.56", "abc", ""],
		["1,234.56", "", ""],
		["1,234.56", "12.", "12."],
	] as const)("reads %s's %j as %j", (format, value, expected) => {
		expect(sanitizeNumber(value, format)).toBe(expected);
	});

	it("reads nothing as nothing", () => {
		expect(sanitizeNumber(undefined, "1,234.56")).toBe("");
	});
});

describe("strptime", () => {
	it.each([
		["%m-%d-%Y", "01-15-2024", "2024-01-15"],
		["%d.%m.%Y", "15.01.2024", "2024-01-15"],
		["%d-%m-%Y", "15-1-2024", "2024-01-15"],
		["%Y-%m-%d", "2024-01-15", "2024-01-15"],
		["%d/%m/%Y", "15/01/2024", "2024-01-15"],
		["%Y/%m/%d", "2024/01/15", "2024-01-15"],
		["%m/%d/%Y", "01/15/2024", "2024-01-15"],
		["%e/%m/%Y", "5/01/2024", "2024-01-05"],
		["%e/%m/%Y", " 5/01/2024", "2024-01-05"],
		["%Y.%m.%d", "2024.01.15", "2024-01-15"],
		["%Y%m%d", "20240115", "2024-01-15"],
		["%d %b %Y", "15 Jan 2024", "2024-01-15"],
		["%d %b %Y", "15 january 2024", "2024-01-15"],
		["%d/%m/%y", "15/01/24", "2024-01-15"],
		["%d/%m/%y", "15/01/69", "1969-01-15"],
		["%d/%m/%y", "15/01/68", "2068-01-15"],
	])("reads %s's %j", (format, text, expected) => {
		expect(strptime(text, format)).toBe(expected);
	});

	it.each([
		["%Y-%m-%d", "2024-13-01"],
		["%Y-%m-%d", "2024-02-30"],
		["%Y-%m-%d", "2024-01-15 extra"],
		["%d/%m/%y", "15/01/2024"],
		["%d %b %Y", "15 Jnv 2024"],
		["%Y-%m-%d", ""],
	])("refuses %s's %j", (format, text) => {
		expect(strptime(text, format)).toBeNull();
	});
});

describe("detectDateFormat", () => {
	const formats = ["%m-%d-%Y", "%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y"];

	it("takes the format reading every sample", () => {
		expect(detectDateFormat(["13/01/2024", "01/02/2024"], formats, "2026-09-21")).toBe("%d/%m/%Y");
	});

	it("breaks a tie on reasonable dates, then on the candidates' order", () => {
		expect(detectDateFormat(["01/02/2024"], formats, "2026-09-21")).toBe("%d/%m/%Y");
		expect(detectDateFormat(["2024-01-02"], formats, "2026-09-21")).toBe("%Y-%m-%d");
	});

	it("falls back to `%Y-%m-%d` when nothing reads", () => {
		expect(detectDateFormat(["hier"], formats, "2026-09-21")).toBe("%Y-%m-%d");
		expect(detectDateFormat([], formats, "2026-09-21")).toBe("%Y-%m-%d");
	});
});

describe("dateValidity", () => {
	it("refuses a date 30 years old or more, or after today, as `Import::Row#date_valid`", () => {
		expect(dateValidity("2024-01-01", "2026-09-21")).toBe("valid");
		expect(dateValidity("2026-09-21", "2026-09-21")).toBe("valid");
		expect(dateValidity("2026-09-22", "2026-09-21")).toBe("out_of_range");
		expect(dateValidity("1996-09-21", "2026-09-21")).toBe("out_of_range");
		expect(dateValidity("1996-09-22", "2026-09-21")).toBe("valid");
	});
});
