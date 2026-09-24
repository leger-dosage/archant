import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import type { CsvMapping } from "@archant/data/schema/imports";

import { LABEL_MAX_LENGTH, NOTES_MAX_LENGTH } from "../../schemas/transactions.ts";
import { MAX_FILE_BYTES } from "../file-source.ts";
import { detectFileSource, fileSource } from "../registry.ts";
import {
	SAMPLE_RECORDS,
	amountOf,
	csvLayout,
	csvSource,
	dateOf,
	defaultMapping,
	fitMapping,
	guessDelimiter,
	mappingFits,
} from "./csv.ts";

const fixture = async (name: string) =>
	new Uint8Array(await readFile(new URL(`fixtures/${name}`, import.meta.url)));

const utf8 = (text: string) => new TextEncoder().encode(text);

const base: CsvMapping = {
	delimiter: ";",
	skipRows: 0,
	hasHeader: true,
	dateFormat: "DD/MM/YYYY",
	decimal: ",",
	sign: "inflows-positive",
	columns: ["date", "label", "amount"],
};

const read = (text: string, mapping: Partial<CsvMapping> = {}) =>
	csvSource.parse(utf8(text), { currency: "EUR", csv: { ...base, ...mapping } });

const HEADER = "Date;Libellé;Montant";

describe("csvSource.parse on the committed bank fixtures", () => {
	it("reads the Société Générale-like export in windows-1252, past its preamble", async () => {
		const parsed = csvSource.parse(await fixture("societe-generale-1252.csv"), {
			currency: "EUR",
			csv: { ...base, skipRows: 3, columns: ["date", "label", "notes", "amount", "ignore"] },
		});

		expect(parsed.rejected).toEqual([]);
		expect(parsed.balance).toBeNull();
		expect(parsed.transactions).toHaveLength(6);
		expect(parsed.transactions[0]).toEqual({
			externalId: null,
			date: "2026-09-03",
			amount: -4290,
			currency: "EUR",
			label: "CARTE X1234 CAFE DE LA GARE",
			reference: null,
			notes: "CARTE X1234 02/09 CAFE DE LA GARE",
			pending: false,
		});
		expect(parsed.transactions[1]?.notes).toBe("Électricité échéance septembre");
		expect(parsed.transactions[2]?.label).toBe("Prélèvement Crédit Agricole");
		expect(parsed.transactions[3]?.amount).toBe(215000);
		expect(parsed.transactions[4]?.notes).toBeNull();
		expect(parsed.transactions.reduce((total, line) => total + line.amount, 0)).toBe(
			-4290 - 8712 - 3150 + 215000 - 350 - 350,
		);
	});

	it("reads the Crédit Agricole-like export with debit and credit columns in UTF-8", async () => {
		const parsed = csvSource.parse(await fixture("credit-agricole-utf8.csv"), {
			currency: "EUR",
			csv: { ...base, skipRows: 1, columns: ["date", "label", "debit", "credit", "ignore"] },
		});

		expect(parsed.rejected).toEqual([]);
		expect(parsed.transactions.map((line) => [line.date, line.amount, line.label])).toEqual([
			["2026-09-03", -4290, "CARTE X1234 02/09 CAFE DE LA GARE"],
			// A label spread over two lines in its quotes reads as one.
			["2026-09-05", -8712, "PRLV SEPA EDF Électricité échéance septembre"],
			["2026-09-08", -3150, "Prélèvement Crédit Agricole"],
			["2026-09-10", 123456, "VIREMENT EN VOTRE FAVEUR SALAIRE"],
			["2026-09-12", -350, "CARTE X1234 BOULANGERIE"],
		]);
	});

	it("reads the Boursorama-like export in UTF-8 with a BOM, ISO dates and several label columns", async () => {
		const parsed = csvSource.parse(await fixture("boursorama-utf8-bom.csv"), {
			currency: "EUR",
			csv: {
				...base,
				skipRows: 1,
				dateFormat: "YYYY-MM-DD",
				columns: [
					"date",
					"ignore",
					"label",
					"ignore",
					"ignore",
					"amount",
					"notes",
					"ignore",
					"ignore",
					"ignore",
				],
			},
		});

		expect(parsed.rejected).toEqual([]);
		expect(parsed.transactions.map((line) => [line.date, line.amount, line.label])).toEqual([
			["2026-09-03", -4290, "CARTE 02/09/26 CAFE DE LA GARE CB*1234"],
			["2026-09-05", -8712, "PRLV SEPA EDF"],
			["2026-09-08", -3150, "Prélèvement Crédit Agricole"],
			["2026-09-10", 215000, "VIR SEPA ACME SAS SALAIRE"],
		]);
		expect(parsed.transactions[1]?.notes).toBe("Échéance septembre");
	});
});

describe("csvSource.parse", () => {
	it("keeps twin lines, so both get their own fingerprint", () => {
		const parsed = read(`${HEADER}\n12/09/2026;CB CAFE;-3,50\n12/09/2026;CB CAFE;-3,50`);

		expect(parsed.transactions).toHaveLength(2);
		expect(parsed.transactions[0]).toEqual(parsed.transactions[1]);
	});

	it("signs debit and credit cells by their column, whatever the cell prints", () => {
		const parsed = read(
			[
				"Date;Libellé;Débit;Crédit",
				"01/09/2026;A;42,90;",
				"02/09/2026;B;;1 200,00",
				"03/09/2026;C;-12,00;",
				"04/09/2026;D;;-5,00",
			].join("\n"),
			{ columns: ["date", "label", "debit", "credit"] },
		);

		expect(parsed.transactions.map((line) => line.amount)).toEqual([-4290, 120000, -1200, 500]);
	});

	it("rejects a line with both or neither debit and credit, with its line in the file", () => {
		const parsed = read(
			[
				"# export",
				"Date;Libellé;Débit;Crédit",
				"01/09/2026;A;42,90;",
				"02/09/2026;B;1,00;2,00",
				"03/09/2026;C;;",
				"04/09/2026;D;abc;",
			].join("\n"),
			{ skipRows: 1, columns: ["date", "label", "debit", "credit"] },
		);

		expect(parsed.rejected).toEqual([
			{ ref: "3", reason: "INVALID_AMOUNT" },
			{ ref: "4", reason: "INVALID_AMOUNT" },
			{ ref: "5", reason: "INVALID_AMOUNT" },
		]);
	});

	it("reads a debit column alone and a credit column alone", () => {
		const debits = read("Date;Libellé;Débit\n01/09/2026;A;4,00\n02/09/2026;B;", {
			columns: ["date", "label", "debit"],
		});
		const credits = read("Date;Libellé;Crédit\n01/09/2026;A;4,00", {
			columns: ["date", "label", "credit"],
		});

		expect(debits.transactions.map((line) => line.amount)).toEqual([-400]);
		expect(debits.rejected).toEqual([{ ref: "2", reason: "INVALID_AMOUNT" }]);
		expect(credits.transactions.map((line) => line.amount)).toEqual([400]);
	});

	it("rejects an impossible date with its line number", () => {
		const parsed = read(`${HEADER}\n31/02/2026;A;-1,00\n01/03/2026;B;-1,00`);

		expect(parsed.rejected).toEqual([{ ref: "1", reason: "INVALID_DATE" }]);
		expect(parsed.transactions).toHaveLength(1);
	});

	it("rejects a decimal point when the decimal is a comma", () => {
		const parsed = read(`${HEADER}\n01/09/2026;A;12.50`);

		expect(parsed.rejected).toEqual([{ ref: "1", reason: "INVALID_AMOUNT" }]);
	});

	it("rejects a line with no label", () => {
		const parsed = read(`${HEADER}\n01/09/2026; ;-1,00`);

		expect(parsed.rejected).toEqual([{ ref: "1", reason: "MISSING_LABEL" }]);
	});

	it("negates a signed amount when inflows are negative", () => {
		const parsed = read(`${HEADER}\n01/09/2026;A;-12,00\n02/09/2026;B;30,00\n03/09/2026;C;x`, {
			sign: "inflows-negative",
		});

		expect(parsed.transactions.map((line) => line.amount)).toEqual([1200, -3000]);
		expect(parsed.rejected).toEqual([{ ref: "3", reason: "INVALID_AMOUNT" }]);
	});

	it.each([
		[";", "01/09/2026;A;-1,50"],
		[",", '01/09/2026,A,"-1,50"'],
		["\t", "01/09/2026\tA\t-1,50"],
	] as const)("splits records on %j", (delimiter, line) => {
		const parsed = read(`${HEADER}\n${line}`, { delimiter });

		expect(parsed.transactions.map((item) => item.amount)).toEqual([-150]);
	});

	it("reads the first record as a line when the file has no header", () => {
		const parsed = read("01/09/2026;A;-1,00\n02/09/2026;B;-2,00", { hasHeader: false });

		expect(parsed.transactions).toHaveLength(2);
	});

	it("skips empty records and counts them in line numbers", () => {
		const parsed = read(`${HEADER}\n\n01/09/2026;A;-1,00\n;;\n\nxx/09/2026;B;-2,00\n`);

		expect(parsed.transactions).toHaveLength(1);
		expect(parsed.rejected).toEqual([{ ref: "5", reason: "INVALID_DATE" }]);
	});

	it("joins several label and notes columns in column order, dropping empty cells", () => {
		const parsed = read(
			[
				"Date;Type;Libellé;Note 1;Note 2;Montant",
				"01/09/2026;CB;  CAFE   DE LA GARE ;;Terrasse;-1,00",
				"02/09/2026;;VIREMENT;;;-2,00",
			].join("\n"),
			{ columns: ["date", "label", "label", "notes", "notes", "amount"] },
		);

		expect(parsed.transactions.map((line) => [line.label, line.notes])).toEqual([
			["CB CAFE DE LA GARE", "Terrasse"],
			["VIREMENT", null],
		]);
	});

	it("cuts labels and notes by code points at their limits", () => {
		const long = `${"a".repeat(LABEL_MAX_LENGTH - 1)}😀😀`;
		const notes = "n".repeat(NOTES_MAX_LENGTH + 5);
		const parsed = read(`Date;Libellé;Montant;Notes\n01/09/2026;${long};-1,00;${notes}`, {
			columns: ["date", "label", "amount", "notes"],
		});

		expect(parsed.transactions[0]?.label).toBe(`${"a".repeat(LABEL_MAX_LENGTH - 1)}😀`);
		expect(parsed.transactions[0]?.notes).toHaveLength(NOTES_MAX_LENGTH);
	});

	it("reads a short record's missing cells as empty", () => {
		const parsed = read(`Date;Libellé;Notes;Montant\n01/09/2026;A`, {
			columns: ["date", "label", "notes", "amount"],
		});

		expect(parsed.rejected).toEqual([{ ref: "1", reason: "INVALID_AMOUNT" }]);
		expect(
			read(`Date;Montant;Libellé\n01/09/2026;-1,00`, { columns: ["date", "amount", "label"] })
				.rejected,
		).toEqual([{ ref: "1", reason: "MISSING_LABEL" }]);
		const split = read(`Date;Libellé;Débit;Crédit\n01/09/2026;A;4,00\n02/09/2026;B`, {
			columns: ["date", "label", "debit", "credit"],
		});
		expect(split.transactions.map((line) => line.amount)).toEqual([-400]);
		expect(split.rejected).toEqual([{ ref: "2", reason: "INVALID_AMOUNT" }]);
	});

	it("rejects every line of a mapping without a date column, which the schema never lets through", () => {
		expect(
			read(`${HEADER}\n01/09/2026;A;-1,00\n01/09/2026`, { columns: ["label", "amount"] }),
		).toEqual({
			transactions: [],
			balance: null,
			rejected: [
				{ ref: "1", reason: "INVALID_DATE" },
				{ ref: "2", reason: "INVALID_DATE" },
			],
		});
	});

	it("refuses a file whose quote never closes, rather than losing its later lines", () => {
		const content = `${HEADER}\n01/09/2026;"CAFE;-1,00\n02/09/2026;B;-2,00`;

		expect(() => read(content)).toThrow(expect.objectContaining({ code: "INVALID_IMPORT_FILE" }));
		expect(() => csvLayout(utf8(content), { delimiter: ";", skipRows: 0 })).toThrow(
			expect.objectContaining({ code: "INVALID_IMPORT_FILE" }),
		);
	});

	it("refuses to read without a mapping", () => {
		expect(() =>
			csvSource.parse(utf8(`${HEADER}\n01/09/2026;A;-1,00`), { currency: "EUR" }),
		).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
	});

	it.each([
		["one column of text", "Liste de courses\npain\nlait"],
		["an empty file", ""],
	])("refuses %s as INVALID_IMPORT_FILE", (_name, content) => {
		expect(() => read(content)).toThrow(expect.objectContaining({ code: "INVALID_IMPORT_FILE" }));
		expect(() => guessDelimiter(utf8(content))).toThrow(
			expect.objectContaining({ code: "INVALID_IMPORT_FILE" }),
		);
	});

	it("refuses a file over 5 MB", () => {
		const bytes = new Uint8Array(MAX_FILE_BYTES + 1).fill(0x3b);

		expect(() => csvSource.parse(bytes, { currency: "EUR", csv: base })).toThrow(
			expect.objectContaining({ code: "INVALID_IMPORT_FILE" }),
		);
	});

	it("parses 5,000 lines well within two seconds", () => {
		const lines = Array.from(
			{ length: 5000 },
			(_, index) =>
				`${String((index % 28) + 1).padStart(2, "0")}/09/2026;CB MAGASIN ${index};-${index},99`,
		);
		const started = performance.now();

		expect(read([HEADER, ...lines].join("\n")).transactions).toHaveLength(5000);
		expect(performance.now() - started).toBeLessThan(2000);
	});
});

describe("dateOf", () => {
	it.each([
		["DD/MM/YYYY", "05/09/2026", "2026-09-05"],
		["DD/MM/YYYY", "5/9/2026", "2026-09-05"],
		["DD/MM/YY", "05/09/26", "2026-09-05"],
		["DD-MM-YYYY", "05-09-2026", "2026-09-05"],
		["DD.MM.YYYY", "05.09.2026", "2026-09-05"],
		["YYYY-MM-DD", " 2026-09-05 ", "2026-09-05"],
		["MM/DD/YYYY", "09/05/2026", "2026-09-05"],
		["DD/MM/YYYY", "29/02/2028", "2028-02-29"],
		["DD/MM/YYYY", "29/02/2026", null],
		["DD/MM/YYYY", "2026-09-05", null],
		["DD/MM/YY", "05/09/2026", null],
		["MM/DD/YYYY", "13/05/2026", null],
		["DD/MM/YYYY", "", null],
	] as const)("reads %s %j as %j", (format, cell, date) => {
		expect(dateOf(cell, format)).toBe(date);
	});
});

describe("amountOf", () => {
	it.each([
		["-42,90", ",", -4290],
		["+42,90", ",", 4290],
		["−42,90", ",", -4290],
		["1 234,56", ",", 123456],
		["1 234,56", ",", 123456],
		["1 234,56", ",", 123456],
		["1.234,56", ",", 123456],
		["1.234.567,00", ",", 123456700],
		["-42,90 €", ",", -4290],
		["€42,90", ",", 4290],
		["42,90 EUR", ",", 4290],
		["42,90 eur", ",", 4290],
		["42", ",", 4200],
		["42,9", ",", 4290],
		["12.50", ",", null],
		["12.5000", ",", null],
		["1.23,00", ",", null],
		["42,905", ",", null],
		["-42.90", ".", -4290],
		["1,234.56", ".", 123456],
		["12,50", ".", null],
		["", ",", null],
		["abc", ",", null],
		["42,90 USD", ",", null],
	] as const)("reads %j with a %j decimal as %j", (cell, decimal, amount) => {
		expect(amountOf(cell, decimal, "EUR")).toBe(amount);
	});
});

describe("the Colonnes step helpers", () => {
	it("guesses the delimiter among the three, and falls back to a semicolon", () => {
		expect(guessDelimiter(utf8("a;b;c\n1;2;3"))).toBe(";");
		expect(guessDelimiter(utf8("a,b,c\n1,2,3"))).toBe(",");
		expect(guessDelimiter(utf8("a\tb\tc\n1\t2\t3"))).toBe("\t");
		expect(guessDelimiter(utf8("Export du compte\nDate,Label,Amount\n01/09/2026,A,-1.00"))).toBe(
			",",
		);
		// A long preamble hides the table from papaparse's first rows.
		const preamble = Array.from({ length: 12 }, (_, index) => `Ligne ${index}`).join("\n");
		expect(guessDelimiter(utf8(`${preamble}\na,b\n1,2`))).toBe(";");
	});

	it("gives the first records as they are, and the widest after skipRows", () => {
		const records = Array.from({ length: SAMPLE_RECORDS + 10 }, (_, index) => `${index};x`);
		const layout = csvLayout(utf8(["a;b;c;d", "", ...records, "a;b;c", ""].join("\n")), {
			delimiter: ";",
			skipRows: 1,
		});

		expect(layout.sample).toHaveLength(SAMPLE_RECORDS);
		expect(layout.sample.slice(0, 3)).toEqual([["a", "b", "c", "d"], [""], ["0", "x"]]);
		expect(layout.width).toBe(3);
		expect(csvLayout(utf8(""), { delimiter: ";", skipRows: 0 })).toEqual({
			sample: [],
			width: 0,
		});
	});

	it("tells whether a mapping's columns all exist, and fits one to a width", () => {
		const mapping: CsvMapping = { ...base, columns: ["date", "label", "ignore", "amount"] };

		expect(mappingFits(mapping, 4)).toBe(true);
		expect(mappingFits(mapping, 3)).toBe(false);
		expect(mappingFits({ ...mapping, columns: ["date", "label", "amount", "ignore"] }, 3)).toBe(
			true,
		);
		expect(fitMapping(mapping, 3).columns).toEqual(["date", "label", "ignore"]);
		expect(fitMapping(mapping, 5).columns).toEqual(["date", "label", "ignore", "amount", "ignore"]);
	});

	it("starts a first import from the French defaults, every column ignored", () => {
		expect(defaultMapping(",", 2)).toEqual({
			delimiter: ",",
			skipRows: 0,
			hasHeader: true,
			dateFormat: "DD/MM/YYYY",
			decimal: ",",
			sign: "inflows-positive",
			columns: ["ignore", "ignore"],
		});
	});
});

describe("csvSource.detect and the registry", () => {
	it("recognises a CSV file by its extension, in any case", () => {
		expect(csvSource.detect(utf8("x"), "releve.csv")).toBe(true);
		expect(csvSource.detect(utf8("x"), "RELEVE.CSV")).toBe(true);
		expect(csvSource.detect(utf8("a;b"), "releve.txt")).toBe(false);
	});

	it("gives OFX its file first, and a CSV file to the CSV source", () => {
		expect(detectFileSource(utf8("Date;Libellé;Montant"), "releve.csv")).toBe(csvSource);
		expect(detectFileSource(utf8("OFXHEADER:100"), "releve.csv")?.id).toBe("ofx");
		expect(fileSource("csv")).toBe(csvSource);
	});
});
