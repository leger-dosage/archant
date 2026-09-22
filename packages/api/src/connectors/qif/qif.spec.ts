import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import type { QifDateOrder } from "@archant/data/qif-options";

import { AppError } from "../../lib/errors.ts";
import { LABEL_MAX_LENGTH, NOTES_MAX_LENGTH } from "../../schemas/transactions.ts";
import { MAX_FILE_BYTES } from "../file-source.ts";
import { detectFileSource, fileSource } from "../registry.ts";
import { REFERENCE_MAX_LENGTH, amountOf, dateOf, qifDateOrder, qifSource } from "./qif.ts";

const fixture = async (name: string) =>
	new Uint8Array(await readFile(new URL(`fixtures/${name}`, import.meta.url)));

const utf8 = (text: string) => new TextEncoder().encode(text);

const read = (text: string, dateOrder?: QifDateOrder) =>
	qifSource.parse(utf8(text), {
		currency: "EUR",
		...(dateOrder === undefined ? {} : { qif: { dateOrder } }),
	});

const bank = (...records: string[]) => ["!Type:Bank", ...records].join("\n");

const refusal = (text: string) => {
	try {
		read(text);
	} catch (error) {
		return error;
	}

	throw new Error("The file was read.");
};

describe("qifSource.parse on the committed fixtures", () => {
	it("reads the La Banque Postale-like export in windows-1252 with its cheque numbers", async () => {
		const parsed = qifSource.parse(await fixture("banque-postale-bank-1252.qif"), {
			currency: "EUR",
		});

		expect(parsed.rejected).toEqual([]);
		expect(parsed.balance).toBeNull();
		expect(parsed.transactions).toHaveLength(6);
		expect(parsed.transactions[0]).toEqual({
			externalId: null,
			date: "2026-09-03",
			amount: -4290,
			currency: "EUR",
			label: "CARTE X1234 CAFÉ DE LA GARE",
			reference: null,
			notes: "CARTE X1234 02/09 CAFÉ DE LA GARE",
		});
		expect(parsed.transactions[1]?.label).toBe("PRLV EDF Électricité échéance septembre");
		expect(parsed.transactions[2]).toMatchObject({ reference: "1234567", notes: null });
		expect(parsed.transactions[3]?.amount).toBe(215000);
		expect(parsed.transactions[4]?.notes).toBe("Boulangerie L'Épi d'or");
		expect(parsed.transactions.reduce((sum, line) => sum + line.amount, 0)).toBe(
			-4290 - 8712 - 15000 + 215000 - 350 - 3500,
		);
	});

	it("reads the card export in UTF-8 with a BOM, decimal point and two-digit years", async () => {
		const bytes = await fixture("card-export-ccard-utf8-bom.qif");
		const parsed = qifSource.parse(bytes, { currency: "EUR" });

		expect(qifDateOrder(bytes)).toEqual({ dateOrder: "day-first", ambiguous: false });
		expect(parsed.rejected).toEqual([]);
		expect(parsed.transactions.map(({ date, amount, label }) => [date, amount, label])).toEqual([
			["2026-09-02", -1290, "CB CRÊPERIE DU PORT"],
			["2026-09-04", -6430, "CB LIBRAIRIE GÉNÉRALE"],
			["2026-09-18", 2500, "REMBOURSEMENT CB"],
			["2026-09-30", -124999, "CB ORDINATEUR"],
		]);
		expect(parsed.transactions[1]?.notes).toBe("Facture n° 2231");
	});

	it("reads the Quicken-like file: lists skipped, apostrophe dates, totals over splits, opening balance refused", async () => {
		const bytes = await fixture("quicken-account-with-lists.qif");
		const parsed = qifSource.parse(bytes, { currency: "EUR" });

		expect(qifDateOrder(bytes)).toEqual({ dateOrder: "month-first", ambiguous: false });
		expect(parsed.rejected).toEqual([{ ref: "0", reason: "OPENING_BALANCE" }]);
		expect(parsed.transactions.map(({ date, amount, label }) => [date, amount, label])).toEqual([
			["2026-01-05", -2850000, "Concession Auto"],
			["2026-01-15", -12045, "Supermarché"],
			["2026-01-31", 320000, "Salaire ACME"],
		]);
	});

	it("refuses the investment file, naming its type", async () => {
		const bytes = await fixture("quicken-investment-invst.qif");
		let caught: unknown;

		try {
			qifSource.parse(bytes, { currency: "EUR" });
		} catch (error) {
			caught = error;
		}

		if (!(caught instanceof AppError)) {
			throw new Error("The file was read.");
		}

		expect(caught.toJSON()).toEqual({
			error: {
				code: "INVALID_IMPORT_FILE",
				message: "QIF statements of type Invst are not supported.",
				params: { type: "Invst" },
			},
		});
	});
});

describe("qifSource.parse, records and sections", () => {
	it("reads the matrix's bank record", () => {
		expect(read(bank("D12/03/2026", "T-42,90", "PCARTE MONOP", "N1234567", "^"))).toEqual({
			transactions: [
				{
					externalId: null,
					date: "2026-03-12",
					amount: -4290,
					currency: "EUR",
					label: "CARTE MONOP",
					reference: "1234567",
					notes: null,
				},
			],
			balance: null,
			rejected: [],
		});
	});

	it("keeps a last record without its caret, skips empty records and blank lines", () => {
		const parsed = read(
			[
				"!Type:Bank",
				"^",
				"",
				"D01/09/2026",
				"T-1,00",
				"PA",
				"^",
				"^",
				"D02/09/2026",
				"T-2,00",
				"PB",
			].join("\r\n"),
		);

		expect(parsed.transactions.map((line) => line.label)).toEqual(["A", "B"]);
	});

	it("reads CR line ends and trims every line", () => {
		const parsed = read(["  !type:ccard  ", "  D01/09/2026 ", " T-1,00", "PA  ", "^"].join("\r"));

		expect(parsed.transactions).toMatchObject([{ date: "2026-09-01", amount: -100, label: "A" }]);
	});

	it("skips list sections and unknown headers with their records, and ignores options", () => {
		const parsed = read(
			[
				"!Option:AutoSwitch",
				"!Type:Class",
				"NPerso",
				"^",
				"!Type:Memorized",
				"PCARTE",
				"T-1,00",
				"^",
				"!Type:Security",
				"NACME",
				"^",
				"!Type:Tag",
				"NVacances",
				"^",
				"!Type:Prices",
				'"ACME",10.00,"1/ 5\'26"',
				"^",
				"!Clear:AutoSwitch",
				"!Option:MDY",
				"!Type:BANK",
				"D01/09/2026",
				"T-1,00",
				"PA",
				"^",
				"!Something:Else",
				"D02/09/2026",
				"T-2,00",
				"PB",
				"^",
			].join("\n"),
		);

		expect(parsed.transactions.map((line) => line.label)).toEqual(["A"]);
	});

	it("ignores records before any header", () => {
		expect(
			read(["D01/09/2026", "T-1,00", "PA", "^", "!Type:Bank"].join("\n")).transactions,
		).toEqual([]);
	});

	it("keeps the first value of a repeated field and ignores categories, splits and addresses", () => {
		const parsed = read(
			bank(
				"D01/09/2026",
				"D02/09/2026",
				"T-10,00",
				"PA",
				"PB",
				"LCourses",
				"C*",
				"A1 rue",
				"SX",
				"EY",
				"$-5,00",
				"^",
			),
		);

		expect(parsed.transactions).toMatchObject([{ date: "2026-09-01", amount: -1000, label: "A" }]);
	});

	it("refuses a file with no transaction section", () => {
		expect(refusal("Bonjour, ceci est un fichier texte.")).toMatchObject({
			code: "INVALID_IMPORT_FILE",
		});
		expect(refusal("!Type:Cat\nNAlimentation\n^")).toMatchObject({ code: "INVALID_IMPORT_FILE" });
	});

	it.each(["Invst", "Cash", "Oth A", "Oth L"])("refuses a %s section, naming it", (type) => {
		const error = refusal(`!Type:${type}\nD01/09/2026\nT-1,00\nPA\n^`);

		expect(error).toBeInstanceOf(AppError);
		expect(error).toMatchObject({
			code: "INVALID_IMPORT_FILE",
			message: `QIF statements of type ${type} are not supported.`,
			params: { type },
		});
	});

	it("refuses an empty type, and cuts a long one in its refusal", () => {
		expect(refusal("!Type:\nD01/09/2026\nT-1,00\nPA\n^")).toMatchObject({
			code: "INVALID_IMPORT_FILE",
			message: "The file is not a readable QIF statement.",
			params: undefined,
		});
		expect(refusal(`!Type:${"x".repeat(100)}\n`)).toMatchObject({
			params: { type: "x".repeat(30) },
		});
	});

	it("reads a single-account export that carries Quicken's account list", () => {
		const parsed = read(
			[
				"!Option:AutoSwitch",
				"!Account",
				"NCompte courant",
				"TBank",
				"^",
				"NLivret A",
				"TBank",
				"^",
				"!Account",
				"NCarte",
				"TCCard",
				"^",
				"!Clear:AutoSwitch",
				"!Account",
				"NCompte courant",
				"TBank",
				"^",
				"!Type:Bank",
				"D01/09/2026",
				"T-1,00",
				"PA",
				"^",
			].join("\n"),
		);

		expect(parsed.transactions.map((line) => line.label)).toEqual(["A"]);
	});

	it("refuses a second transaction section or a second account", () => {
		const record = "D01/09/2026\nT-1,00\nPA\n^";

		expect(refusal(`!Type:Bank\n${record}\n!Type:CCard\n${record}`)).toMatchObject({
			code: "INVALID_IMPORT_FILE",
			params: undefined,
		});
		expect(
			refusal(
				`!Account\nNCourant\nTBank\n^\n!Type:Bank\n${record}\n!Account\nNLivret\nTBank\n^\n!Type:Cat\n`,
			),
		).toMatchObject({ code: "INVALID_IMPORT_FILE" });
	});

	it("refuses a file larger than the limit before reading it", () => {
		expect(() => qifSource.parse(new Uint8Array(MAX_FILE_BYTES + 1), { currency: "EUR" })).toThrow(
			AppError,
		);
		expect(() => qifDateOrder(new Uint8Array(MAX_FILE_BYTES + 1))).toThrow(AppError);
	});
});

describe("qifSource.parse, fields", () => {
	it("reads U only when T is absent or empty", () => {
		const parsed = read(
			bank(
				"D01/09/2026",
				"U-28,500.00",
				"T-28,500.00",
				"PA",
				"^",
				"D01/09/2026",
				"U-7,00",
				"PB",
				"^",
				"D01/09/2026",
				"T",
				"U-8,00",
				"PC",
				"^",
			),
		);

		expect(parsed.transactions.map((line) => line.amount)).toEqual([-2850000, -700, -800]);
	});

	it("falls back to the memo for the label, and keeps a differing memo as notes", () => {
		const parsed = read(
			bank(
				"D01/09/2026",
				"T-1,00",
				"P",
				"M  Loyer   septembre ",
				"^",
				"D01/09/2026",
				"T-1,00",
				"PLoyer",
				"MLoyer",
				"^",
				"D01/09/2026",
				"T-1,00",
				"PLoyer",
				"^",
			),
		);

		expect(parsed.transactions.map(({ label, notes }) => [label, notes])).toEqual([
			["Loyer septembre", null],
			["Loyer", null],
			["Loyer", null],
		]);
	});

	it("cuts the label, notes and reference by code points", () => {
		const long = "😀".repeat(NOTES_MAX_LENGTH + 10);
		const [line] = read(
			bank("D01/09/2026", "T-1,00", `P${long}`, `Mx${long}`, `N${"7".repeat(80)}`, "^"),
		).transactions;

		expect(Array.from(line?.label ?? "")).toHaveLength(LABEL_MAX_LENGTH);
		expect(Array.from(line?.notes ?? "")).toHaveLength(NOTES_MAX_LENGTH);
		expect(line?.reference).toBe("7".repeat(REFERENCE_MAX_LENGTH));
	});

	it("rejects unreadable records by their rank among transactions", () => {
		const parsed = read(
			bank(
				"D01/09/2026",
				"T-1,00",
				"PA",
				"^",
				"T-1,00",
				"PNo date",
				"^",
				"D31/02/2026",
				"T-1,00",
				"PBad date",
				"^",
				"D01/09/2026",
				"PNo amount",
				"^",
				"D01/09/2026",
				"T12,5,0",
				"PBad amount",
				"^",
				"D01/09/2026",
				"T-1,00",
				"^",
				"D01/09/2026",
				"T100,00",
				"Popening BALANCE",
				"^",
			),
		);

		expect(parsed.transactions).toHaveLength(1);
		expect(parsed.rejected).toEqual([
			{ ref: "1", reason: "INVALID_DATE" },
			{ ref: "2", reason: "INVALID_DATE" },
			{ ref: "3", reason: "INVALID_AMOUNT" },
			{ ref: "4", reason: "INVALID_AMOUNT" },
			{ ref: "5", reason: "MISSING_LABEL" },
			{ ref: "6", reason: "OPENING_BALANCE" },
		]);
	});

	it("keeps two identical records", () => {
		const record = ["D01/09/2026", "T-3,50", "PBOULANGERIE", "^"];

		expect(read(bank(...record, ...record)).transactions).toHaveLength(2);
	});

	it("reads 5,000 records in under two seconds", () => {
		const records = Array.from({ length: 5000 }, (_, index) =>
			[
				`D${(index % 28) + 1}/09/2026`,
				`T-${index},50`,
				`POpération ${index}`,
				`N${index}`,
				"^",
			].join("\n"),
		);
		const started = performance.now();

		expect(read(bank(...records)).transactions).toHaveLength(5000);
		expect(performance.now() - started).toBeLessThan(2000);
	});
});

describe("dateOf", () => {
	it.each([
		["12/03/2026", "day-first", "2026-03-12"],
		["12/03/2026", "month-first", "2026-12-03"],
		["1/ 5'24", "day-first", "2024-05-01"],
		["1/ 5'24", "month-first", "2024-01-05"],
		["12.03.26", "day-first", "2026-03-12"],
		["12-03-2026", "day-first", "2026-03-12"],
		["2026-03-12", "month-first", "2026-03-12"],
		["2026/3/2", "day-first", "2026-03-02"],
		["03/29/2026", "day-first", null],
		["03/29/2026", "month-first", "2026-03-29"],
		["2026-03-2026", "day-first", null],
		["123/03/2026", "day-first", null],
		["12/03/026", "day-first", null],
		["12 mars 2026", "day-first", null],
		["", "day-first", null],
	] as const)("reads %s %s as %s", (field, order, expected) => {
		expect(dateOf(field, order)).toBe(expected);
	});
});

describe("amountOf", () => {
	it.each([
		["-42,90", -4290],
		["42.9", 4290],
		["+42,90", 4290],
		["−42,90", -4290],
		["1.234,56", 123456],
		["1,234.56", 123456],
		["1 234,56", 123456],
		["1 234,56", 123456],
		["-28,500.00", -2850000],
		["1,234", 123400],
		["1.234.567", 123456700],
		["1234", 123400],
		["12,5,0", null],
		["1.234.56", null],
		["1,234.567,89", null],
		["12,345", 1234500],
		["12,3456", null],
		["12.50 €", null],
		["", null],
	] as const)("reads %s as %s", (field, expected) => {
		expect(amountOf(field, "EUR")).toBe(expected);
	});
});

describe("qifDateOrder", () => {
	const order = (...dates: string[]) =>
		qifDateOrder(utf8(bank(...dates.flatMap((date) => [`D${date}`, "T-1,00", "PA", "^"]))));

	it("picks day-first and calls it ambiguous when every date reads both ways", () => {
		expect(order("01/02/2026", "03/04/2026")).toEqual({ dateOrder: "day-first", ambiguous: true });
	});

	it("settles on the only order that reads every date", () => {
		expect(order("01/02/2026", "03/29/2026")).toEqual({
			dateOrder: "month-first",
			ambiguous: false,
		});
		expect(order("01/02/2026", "29/03/2026")).toEqual({ dateOrder: "day-first", ambiguous: false });
	});

	it("leaves out a date neither order reads", () => {
		expect(order("01/02/2026", "03/04/2026", "31/31/2026")).toEqual({
			dateOrder: "day-first",
			ambiguous: true,
		});
		expect(order("01/02/2026", "03/29/2026", "31/31/2026")).toEqual({
			dateOrder: "month-first",
			ambiguous: false,
		});
	});

	it("falls back to day-first when neither order reads every date", () => {
		expect(order("29/03/2026", "03/29/2026")).toEqual({ dateOrder: "day-first", ambiguous: false });
	});

	it("offers no choice when both orders read every date the same", () => {
		expect(order("2026-03-04", "05/05/2026")).toEqual({ dateOrder: "day-first", ambiguous: false });
		expect(qifDateOrder(utf8(bank("T-1,00", "PA", "^")))).toEqual({
			dateOrder: "day-first",
			ambiguous: false,
		});
	});

	it("is what parse uses without a stored choice, and a stored choice wins", () => {
		const text = bank("D01/02/2026", "T-1,00", "PA", "^");

		expect(read(text).transactions[0]?.date).toBe("2026-02-01");
		expect(read(text, "month-first").transactions[0]?.date).toBe("2026-01-02");
		expect(read(bank("D03/29/2026", "T-1,00", "PA", "^")).transactions[0]?.date).toBe("2026-03-29");
	});
});

describe("detection", () => {
	it("recognises a .qif name in any case, whatever the content", () => {
		expect(qifSource.detect(utf8(""), "releve.QIF")).toBe(true);
		expect(detectFileSource(utf8("anything"), "export.qif")).toBe(qifSource);
	});

	it.each(["!Type:Bank", "\n\n  !type:ccard", "!Account", "﻿!Option:AutoSwitch"])(
		"recognises a file starting with %j",
		(head) => {
			expect(detectFileSource(utf8(`${head}\nD01/09/2026\n^`), "export.txt")).toBe(qifSource);
		},
	);

	it("leaves other files alone", () => {
		expect(qifSource.detect(utf8(""), "export.txt")).toBe(false);
		expect(qifSource.detect(utf8("Date;Libellé;Montant"), "export.csv")).toBe(false);
		expect(detectFileSource(utf8("Date;Libellé;Montant"), "export.csv")?.id).toBe("csv");
	});

	it("is registered under its id", () => {
		expect(fileSource("qif")).toBe(qifSource);
	});
});
