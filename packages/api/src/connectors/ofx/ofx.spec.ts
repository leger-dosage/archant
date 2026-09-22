import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { MAX_FILE_BYTES } from "../file-source.ts";
import { detectFileSource, fileSource } from "../registry.ts";
import { closeEmptyLeaves, labelOf, ofxSource } from "./ofx.ts";

const eur = { currency: "EUR" } as const;

const fixture = async (name: string) =>
	new Uint8Array(await readFile(new URL(`fixtures/${name}`, import.meta.url)));

const utf8 = (text: string) => new TextEncoder().encode(text);

type Line = {
	fitid?: string | undefined;
	date?: string | undefined;
	amount?: string | undefined;
	name?: string | undefined;
	memo?: string | undefined;
};

function sgmlLine(line: Line): string {
	return [
		"<STMTTRN>",
		"<TRNTYPE>OTHER",
		line.date === undefined ? "" : `<DTPOSTED>${line.date}`,
		line.amount === undefined ? "" : `<TRNAMT>${line.amount}`,
		line.fitid === undefined ? "" : `<FITID>${line.fitid}`,
		line.name === undefined ? "" : `<NAME>${line.name}`,
		line.memo === undefined ? "" : `<MEMO>${line.memo}`,
		"</STMTTRN>",
	]
		.filter((part) => part !== "")
		.join("\n");
}

const statement = (list: string, currency = "EUR") =>
	`<STMTRS>\n<CURDEF>${currency}\n<BANKTRANLIST>\n<DTSTART>20260901\n${list}\n</BANKTRANLIST>\n</STMTRS>`;

/** An OFX 1.x bank statement, header included, holding `body` in its message set. */
function bankFile(body: string, header = "CHARSET:NONE"): string {
	return [
		"OFXHEADER:100",
		"DATA:OFXSGML",
		"VERSION:102",
		header,
		"",
		"<OFX>",
		"<BANKMSGSRSV1>",
		"<STMTTRNRS>",
		body,
		"</STMTTRNRS>",
		"</BANKMSGSRSV1>",
		"</OFX>",
	].join("\n");
}

const file = (...lines: Line[]) => utf8(bankFile(statement(lines.map(sgmlLine).join("\n"))));

/** A valid one-line statement grown to `size` bytes by blank lines before `<OFX>`. */
function padded(size: number): Uint8Array {
	const body = file(valid);
	const bytes = new Uint8Array(size).fill(0x0a);

	bytes.set(body, size - body.length);

	return bytes;
}

const valid: Line = {
	fitid: "F1",
	date: "20260912",
	amount: "-42,90",
	name: "CB CAFE",
};

describe("ofxSource.parse on the committed bank fixtures", () => {
	it("reads the Crédit Agricole SGML export in windows-1252, with empty tags and commas", async () => {
		const parsed = ofxSource.parse(await fixture("credit-agricole-102-sgml.ofx"), eur);

		expect(parsed).toEqual({
			rejected: [],
			balance: { amount: 123456, currency: "EUR", date: "2026-09-15" },
			transactions: [
				{
					externalId: "0000001",
					date: "2026-09-03",
					amount: -4290,
					currency: "EUR",
					label: "CB CAFÉ DE LA GARE",
					notes: null,
				},
				{
					externalId: "0000002",
					date: "2026-09-05",
					amount: -8712,
					currency: "EUR",
					label: "PRLV SEPA EDF Électricité échéance septembre",
					notes: null,
				},
				{
					externalId: "0000003",
					date: "2026-09-08",
					amount: 215000,
					currency: "EUR",
					label: "VIR SALAIRE",
					notes: null,
				},
				{
					externalId: "0000004",
					date: "2026-09-10",
					amount: -350,
					currency: "EUR",
					label: "CB BOULANGERIE",
					notes: null,
				},
				{
					externalId: "0000005",
					date: "2026-09-10",
					amount: -350,
					currency: "EUR",
					label: "CB BOULANGERIE",
					notes: null,
				},
			],
		});
	});

	it("reads the Boursorama XML export in UTF-8, keeping the posting day whatever the time", async () => {
		const parsed = ofxSource.parse(await fixture("boursorama-211-xml.ofx"), eur);

		expect(parsed.rejected).toEqual([]);
		expect(parsed.balance).toEqual({ amount: 240861, currency: "EUR", date: "2026-09-15" });
		expect(parsed.transactions).toEqual([
			{
				externalId: "BRS-0001",
				date: "2026-09-04",
				amount: -1840,
				currency: "EUR",
				label: "CARTE 03/09 PHARMACIE Pharmacie Hôtel de Ville",
				notes: null,
			},
			{
				externalId: "BRS-0002",
				date: "2026-09-06",
				amount: 50000,
				currency: "EUR",
				label: "VIR Épargne",
				notes: null,
			},
			{
				externalId: "BRS-0003",
				date: "2026-09-12",
				amount: -6499,
				currency: "EUR",
				label: "PRLV Free Mobile Forfait & options",
				notes: null,
			},
		]);
	});

	it("reads the Société Générale card export, its negative balance signed as the bank prints it", async () => {
		const parsed = ofxSource.parse(await fixture("societe-generale-card-102-sgml.ofx"), eur);

		expect(parsed).toEqual({
			rejected: [],
			balance: { amount: -51230, currency: "EUR", date: "2026-09-15" },
			transactions: [
				{
					externalId: "SG-CB-0001",
					date: "2026-09-02",
					amount: -12340,
					currency: "EUR",
					label: "CARTE X0000 HÔTEL DU PORT",
					notes: null,
				},
				{
					externalId: "SG-CB-0002",
					date: "2026-09-07",
					amount: -38890,
					currency: "EUR",
					label: "CARTE X0000 ÉLECTROMÉNAGER Réfrigérateur",
					notes: null,
				},
			],
		});
	});
});

/** A bank statement with one line and `ledger` placed after its list. */
const withLedger = (ledger: string) =>
	utf8(bankFile(statement(sgmlLine(valid)).replace("</STMTRS>", `${ledger}\n</STMTRS>`)));

describe("ofxSource.parse, the statement balance", () => {
	it("reads LEDGERBAL with a decimal comma, in the statement's currency", () => {
		const parsed = ofxSource.parse(
			withLedger("<LEDGERBAL>\n<BALAMT>1234,5\n<DTASOF>20260915083000[+2:CEST]\n</LEDGERBAL>"),
			eur,
		);

		expect(parsed.balance).toEqual({ amount: 123450, currency: "EUR", date: "2026-09-15" });
		expect(parsed.transactions).toHaveLength(1);
	});

	it("keeps a card's positive balance positive: a credit, per the OFX specification", () => {
		const card = [
			"<OFX>",
			"<CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS>",
			"<CURDEF>EUR",
			"<LEDGERBAL><BALAMT>+20.00<DTASOF>20260915</LEDGERBAL>",
			"</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1>",
			"</OFX>",
		].join("\n");

		expect(ofxSource.parse(utf8(card), eur).balance).toEqual({
			amount: 2000,
			currency: "EUR",
			date: "2026-09-15",
		});
	});

	it.each([
		["no LEDGERBAL", ""],
		["an empty LEDGERBAL", "<LEDGERBAL>\n</LEDGERBAL>"],
		["an unreadable amount", "<LEDGERBAL>\n<BALAMT>12,345\n<DTASOF>20260915\n</LEDGERBAL>"],
		["no amount", "<LEDGERBAL>\n<DTASOF>20260915\n</LEDGERBAL>"],
		["an unreadable date", "<LEDGERBAL>\n<BALAMT>12,34\n<DTASOF>20260231\n</LEDGERBAL>"],
		["no date", "<LEDGERBAL>\n<BALAMT>12,34\n</LEDGERBAL>"],
	])("gives no balance for %s, and keeps the lines", (_name, ledger) => {
		const parsed = ofxSource.parse(withLedger(ledger), eur);

		expect(parsed.balance).toBeNull();
		expect(parsed.transactions).toHaveLength(1);
		expect(parsed.rejected).toEqual([]);
	});
});

describe("ofxSource.parse", () => {
	it("reads a credit card statement", () => {
		const card = [
			"<OFX>",
			"<CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS>",
			"<CURDEF>EUR",
			"<BANKTRANLIST>",
			sgmlLine({ ...valid, amount: "-30.00" }),
			"</BANKTRANLIST>",
			"</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1>",
			"</OFX>",
		].join("\n");

		expect(ofxSource.parse(utf8(card), eur).transactions).toEqual([
			expect.objectContaining({ amount: -3000, label: "CB CAFE" }),
		]);
	});

	it("keeps the sign, a leading plus, and scales to the account currency", () => {
		const parsed = ofxSource.parse(
			file(
				{ ...valid, amount: "+12.5" },
				{ ...valid, amount: "-0,01" },
				{ ...valid, amount: "1234" },
			),
			eur,
		);

		expect(parsed.transactions.map((line) => line.amount)).toEqual([1250, -1, 123400]);
		expect(
			ofxSource
				.parse(
					file(
						{ ...valid, amount: ".50" },
						{ ...valid, amount: "-.99" },
						{ ...valid, amount: "-,5" },
						{ ...valid, amount: "12.500" },
						{ ...valid, amount: "12,3000" },
						{ ...valid, amount: "7.00" },
					),
					eur,
				)
				.transactions.map((line) => line.amount),
		).toEqual([50, -99, -50, 1250, 1230, 700]);
		expect(
			ofxSource.parse(file({ ...valid, amount: "-1200.00" }), { currency: "JPY" }).transactions,
		).toEqual([expect.objectContaining({ amount: -1200 })]);
		expect(ofxSource.parse(file({ ...valid, amount: "-1200" }), { currency: "JPY" })).toMatchObject(
			{ transactions: [{ amount: -1200 }] },
		);
	});

	it("takes the currency from CURDEF, for the ledger to compare with the account's", () => {
		const bytes = utf8(bankFile(statement(sgmlLine(valid), "USD")));

		expect(ofxSource.parse(bytes, eur).transactions).toEqual([
			expect.objectContaining({ currency: "USD", amount: -4290 }),
		]);
	});

	it("rejects an unreadable line with its code and its index, and keeps the others", () => {
		const parsed = ofxSource.parse(
			file(
				{ ...valid, date: "2026-09-12" },
				{ ...valid, amount: "12,345" },
				{ ...valid, name: " ", memo: undefined },
				valid,
				{ ...valid, date: undefined },
				{ ...valid, amount: undefined },
				{ ...valid, date: "20260231" },
				{ ...valid, amount: "12.3450" },
				{ ...valid, amount: "." },
			),
			eur,
		);

		expect(parsed.rejected).toEqual([
			{ ref: "0", reason: "INVALID_DATE" },
			{ ref: "1", reason: "INVALID_AMOUNT" },
			{ ref: "2", reason: "MISSING_LABEL" },
			{ ref: "4", reason: "INVALID_DATE" },
			{ ref: "5", reason: "INVALID_AMOUNT" },
			{ ref: "6", reason: "INVALID_DATE" },
			{ ref: "7", reason: "INVALID_AMOUNT" },
			{ ref: "8", reason: "INVALID_AMOUNT" },
		]);
		expect(parsed.transactions).toHaveLength(1);
	});

	it("gives a line without FITID no external id", () => {
		const parsed = ofxSource.parse(
			file({ ...valid, fitid: undefined }, { ...valid, fitid: " " }),
			eur,
		);

		expect(parsed.transactions.map((line) => line.externalId)).toEqual([null, null]);
	});

	it("cuts a label past 200 characters", () => {
		const parsed = ofxSource.parse(
			file({ ...valid, name: "A".repeat(150), memo: "B".repeat(150) }),
			eur,
		);

		expect(parsed.transactions[0]?.label).toHaveLength(200);
	});

	it("cuts a label by code points, never through an emoji", () => {
		const parsed = ofxSource.parse(file({ ...valid, name: `${"A".repeat(199)}😀B` }), eur);
		const label = parsed.transactions[0]?.label ?? "";

		expect(label.endsWith("😀")).toBe(true);
		expect(Array.from(label)).toHaveLength(200);
	});

	it("reads a statement with no line, an empty list or no list", () => {
		const noLine = bankFile(statement(""));
		const emptyList = bankFile("<STMTRS>\n<CURDEF>EUR\n<BANKTRANLIST>\n</BANKTRANLIST>\n</STMTRS>");
		const noList = bankFile("<STMTRS>\n<CURDEF>EUR\n</STMTRS>");

		for (const text of [noLine, emptyList, noList]) {
			expect(ofxSource.parse(utf8(text), eur)).toEqual({
				transactions: [],
				balance: null,
				rejected: [],
			});
		}
	});

	it("decodes windows-1252 when the header says so, even from valid UTF-8 bytes", () => {
		const text = bankFile(statement(sgmlLine({ ...valid, name: "CAFÉ" })), "CHARSET:1252");
		const bytes = new Uint8Array(Buffer.from(text, "latin1"));

		expect(ofxSource.parse(bytes, eur).transactions[0]?.label).toBe("CAFÉ");
		expect(ofxSource.parse(utf8(text), eur).transactions[0]?.label).toBe("CAFÃ‰");
	});

	it.each([
		["CHARSET:ISO-8859-1", "CHARSET:ISO-8859-1"],
		["CHARSET:8859-1", "CHARSET:8859-1"],
		["a lower-case header", "charset:iso-8859-1"],
		["an XML prologue declaring windows-1252", '<?xml version="1.0" encoding="windows-1252"?>'],
		["an XML prologue declaring ISO-8859-1", "<?xml version='1.0' encoding='iso-8859-1'?>"],
	])("decodes windows-1252 for %s, even from valid UTF-8 bytes", (_name, header) => {
		const text = bankFile(statement(sgmlLine({ ...valid, name: "CAFÉ" })), header);

		expect(ofxSource.parse(utf8(text), eur).transactions[0]?.label).toBe("CAFÃ‰");
	});

	it("reads UTF-8 when the prologue declares it", () => {
		const text = bankFile(
			statement(sgmlLine({ ...valid, name: "CAFÉ" })),
			'<?xml version="1.0" encoding="UTF-8"?>',
		);

		expect(ofxSource.parse(utf8(text), eur).transactions[0]?.label).toBe("CAFÉ");
	});

	it("strips a UTF-8 byte order mark", () => {
		const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...file(valid)]);

		expect(ofxSource.parse(bytes, eur).transactions).toHaveLength(1);
	});

	it.each([
		[
			"two statements in one response",
			bankFile(`${statement(sgmlLine(valid))}\n${statement(sgmlLine(valid))}`),
		],
		[
			"two responses",
			bankFile(
				`${statement(sgmlLine(valid))}\n</STMTTRNRS>\n<STMTTRNRS>\n${statement(sgmlLine(valid))}`,
			),
		],
		[
			"a bank and a card statement",
			bankFile(statement(sgmlLine(valid))).replace(
				"</OFX>",
				"<CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>EUR</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>",
			),
		],
		["no statement", "OFXHEADER:100\n<OFX>\n<SIGNONMSGSRSV1>\n</SIGNONMSGSRSV1>\n</OFX>"],
		["no currency", bankFile("<STMTRS>\n<BANKTRANLIST>\n</BANKTRANLIST>\n</STMTRS>")],
		["plain text", "Relevé de compte\nsolde : 12,00"],
		["mismatched tags", "<OFX><BANKMSGSRSV1></STMTRS></OFX>"],
		["a line that is not an aggregate", bankFile(statement("<STMTTRN>oops</STMTTRN>"))],
	])("refuses %s as INVALID_IMPORT_FILE", (_name, text) => {
		expect(() => ofxSource.parse(utf8(text), eur)).toThrow(
			expect.objectContaining({ code: "INVALID_IMPORT_FILE" }),
		);
	});

	it("reads a valid statement of exactly 5 MB and refuses one a byte longer", () => {
		expect(ofxSource.parse(padded(MAX_FILE_BYTES), eur).transactions).toHaveLength(1);
		expect(() => ofxSource.parse(padded(MAX_FILE_BYTES + 1), eur)).toThrow(
			expect.objectContaining({ code: "INVALID_IMPORT_FILE" }),
		);
	});

	it("parses 5,000 lines well within a second", () => {
		const lines = Array.from({ length: 5000 }, (_, index) =>
			sgmlLine({ ...valid, fitid: String(index), memo: "" }),
		);
		const started = performance.now();

		expect(
			ofxSource.parse(utf8(bankFile(statement(lines.join("\n")))), eur).transactions,
		).toHaveLength(5000);
		expect(performance.now() - started).toBeLessThan(2000);
	});
});

describe("closeEmptyLeaves", () => {
	it("closes an empty leaf and leaves aggregates and filled leaves alone", () => {
		expect(closeEmptyLeaves("<A>\n<MEMO>\n<NAME>x\n<MEMO>\n</A>")).toBe(
			"<A>\n<MEMO></MEMO>\n<NAME>x\n<MEMO></MEMO>\n</A>",
		);
	});

	it("leaves an XML empty element as it is", () => {
		expect(closeEmptyLeaves("<A><MEMO></MEMO></A>")).toBe("<A><MEMO></MEMO></A>");
	});
});

describe("labelOf", () => {
	it.each([
		["CB CAFE", "", "CB CAFE"],
		["", "Virement reçu", "Virement reçu"],
		["VIR SALAIRE", "VIR SALAIRE", "VIR SALAIRE"],
		["PRLV SEPA EDF CLIENT 42", "EDF CLIENT", "PRLV SEPA EDF CLIENT 42"],
		["EDF", "PRLV SEPA EDF", "PRLV SEPA EDF"],
		["  PRLV   SEPA ", " Électricité\n sept. ", "PRLV SEPA Électricité sept."],
		[undefined, undefined, ""],
	])("labels NAME %j and MEMO %j as %j", (name, memo, label) => {
		expect(labelOf(name, memo)).toBe(label);
	});
});

describe("ofxSource.detect and the registry", () => {
	it("recognises an OFX file by its name or its header", () => {
		expect(ofxSource.detect(utf8("x"), "releve.OFX")).toBe(true);
		expect(ofxSource.detect(utf8("x"), "releve.qfx")).toBe(true);
		expect(ofxSource.detect(utf8("OFXHEADER:100\n"), "export")).toBe(true);
		expect(ofxSource.detect(utf8('<?xml version="1.0"?>\n<OFX>'), "export.xml")).toBe(true);
		expect(ofxSource.detect(utf8("Date;Libellé;Montant"), "releve.csv")).toBe(false);
	});

	it("finds the source of a file, or none, and a stored import's source by id", () => {
		expect(detectFileSource(utf8("OFXHEADER:100"), "a.txt")).toBe(ofxSource);
		expect(detectFileSource(utf8("hello"), "notes.txt")).toBeNull();
		expect(fileSource("ofx")).toBe(ofxSource);
	});
});
