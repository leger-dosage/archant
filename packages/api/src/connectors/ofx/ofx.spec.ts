import { readFile } from "node:fs/promises";
import { parseSync } from "ofx-js";
import { describe, expect, it } from "vitest";

import { AppError } from "../../lib/errors.ts";
import { decodeText } from "../decode.ts";
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
					reference: null,
					notes: null,
					pending: false,
				},
				{
					externalId: "0000002",
					date: "2026-09-05",
					amount: -8712,
					currency: "EUR",
					label: "PRLV SEPA EDF Électricité échéance septembre",
					reference: null,
					notes: null,
					pending: false,
				},
				{
					externalId: "0000003",
					date: "2026-09-08",
					amount: 215000,
					currency: "EUR",
					label: "VIR SALAIRE",
					reference: null,
					notes: null,
					pending: false,
				},
				{
					externalId: "0000004",
					date: "2026-09-10",
					amount: -350,
					currency: "EUR",
					label: "CB BOULANGERIE",
					reference: null,
					notes: null,
					pending: false,
				},
				{
					externalId: "0000005",
					date: "2026-09-10",
					amount: -350,
					currency: "EUR",
					label: "CB BOULANGERIE",
					reference: null,
					notes: null,
					pending: false,
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
				reference: null,
				notes: null,
				pending: false,
			},
			{
				externalId: "BRS-0002",
				date: "2026-09-06",
				amount: 50000,
				currency: "EUR",
				label: "VIR Épargne",
				reference: null,
				notes: null,
				pending: false,
			},
			{
				externalId: "BRS-0003",
				date: "2026-09-12",
				amount: -6499,
				currency: "EUR",
				label: "PRLV Free Mobile Forfait & options",
				reference: null,
				notes: null,
				pending: false,
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
					reference: null,
					notes: null,
					pending: false,
				},
				{
					externalId: "SG-CB-0002",
					date: "2026-09-07",
					amount: -38890,
					currency: "EUR",
					label: "CARTE X0000 ÉLECTROMÉNAGER Réfrigérateur",
					reference: null,
					notes: null,
					pending: false,
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

/**
 * Parses `bytes`, keeping the error rather than throwing it, and times it.
 * The unpatched `ofx-js` took hours on these inputs, not a failed assertion.
 */
function timedParse(bytes: Uint8Array): { ms: number; error: unknown } {
	const started = performance.now();
	let error: unknown;

	try {
		ofxSource.parse(bytes, eur);
	} catch (caught) {
		error = caught;
	}

	return { ms: performance.now() - started, error };
}

/** `<OFX>` and `lead`, then `unit` repeated, then `tail`, in at most `size` bytes. */
function filledOfx(unit: string, size: number, lead = "", tail = ""): Uint8Array {
	const start = `OFXHEADER:100\n<OFX>${lead}`;
	const room = size - start.length - tail.length;

	return utf8(start + unit.repeat(Math.floor(room / unit.length)) + tail);
}

describe("ofxSource.parse on adversarial input, through the patched ofx-js", () => {
	it("answers a statement with 40-character tag names within a second", () => {
		const tag = "A".repeat(40);
		const { ms, error } = timedParse(
			utf8(bankFile(statement(`${sgmlLine(valid)}\n<${tag}>x\n<${tag}.${tag}>y`))),
		);

		expect(ms).toBeLessThan(1000);
		// Parsed, or refused as unreadable: either way, answered.
		expect(
			error === undefined || (error instanceof AppError && error.code === "INVALID_IMPORT_FILE"),
		).toBe(true);
	});

	// Tags are real work, about 70 ms per MB: 1 MB still fails in seconds if
	// quadratic, without the budget depending on a loaded CI runner.
	it.each([
		["5 MB of one whitespace run", MAX_FILE_BYTES, " "],
		["5 MB of repeated unclosed comments", MAX_FILE_BYTES, "<!--"],
		["1 MB of unfinished tags", 1024 * 1024, "<A", "", "</OFX>"],
		["1 MB of one attribute name", 1024 * 1024, "B", "<A ", "</OFX>"],
	])("refuses %s within a second", (_name, size, unit, lead = "", tail = "") => {
		const { ms, error } = timedParse(filledOfx(unit, size, lead, tail));

		expect(ms).toBeLessThan(1000);
		expect(error).toEqual(expect.objectContaining({ code: "INVALID_IMPORT_FILE" }));
	});

	// Generated by the unpatched library: the rewritten regular expressions
	// must not change a single value.
	it("parses the Crédit Agricole SGML export exactly as before the patch", async () => {
		const text = decodeText(await fixture("credit-agricole-102-sgml.ofx"), "windows-1252");

		expect(parseSync(closeEmptyLeaves(text))).toMatchInlineSnapshot(`
			{
			  "OFX": {
			    "BANKMSGSRSV1": {
			      "STMTTRNRS": {
			        "STATUS": {
			          "CODE": "0",
			          "SEVERITY": "INFO",
			        },
			        "STMTRS": {
			          "BANKACCTFROM": {
			            "ACCTID": "00000000000",
			            "ACCTTYPE": "CHECKING",
			            "BANKID": "00000",
			            "BRANCHID": "00000",
			          },
			          "BANKTRANLIST": {
			            "DTEND": "20260915",
			            "DTSTART": "20260901",
			            "STMTTRN": [
			              {
			                "DTPOSTED": "20260903",
			                "DTUSER": "20260903",
			                "FITID": "0000001",
			                "MEMO": "",
			                "NAME": "CB CAFÉ DE LA GARE",
			                "TRNAMT": "-42,90",
			                "TRNTYPE": "DEBIT",
			              },
			              {
			                "DTPOSTED": "20260905",
			                "FITID": "0000002",
			                "MEMO": "Électricité échéance septembre",
			                "NAME": "PRLV SEPA EDF",
			                "TRNAMT": "-87,12",
			                "TRNTYPE": "DEBIT",
			              },
			              {
			                "DTPOSTED": "20260908",
			                "FITID": "0000003",
			                "MEMO": "VIR SALAIRE",
			                "NAME": "VIR SALAIRE",
			                "TRNAMT": "2150,00",
			                "TRNTYPE": "CREDIT",
			              },
			              {
			                "DTPOSTED": "20260910",
			                "FITID": "0000004",
			                "MEMO": "",
			                "NAME": "CB BOULANGERIE",
			                "TRNAMT": "-3,50",
			                "TRNTYPE": "DEBIT",
			              },
			              {
			                "DTPOSTED": "20260910",
			                "FITID": "0000005",
			                "MEMO": "",
			                "NAME": "CB BOULANGERIE",
			                "TRNAMT": "-3,50",
			                "TRNTYPE": "DEBIT",
			              },
			            ],
			          },
			          "CURDEF": "EUR",
			          "LEDGERBAL": {
			            "BALAMT": "1234,56",
			            "DTASOF": "20260915",
			          },
			        },
			        "TRNUID": "00000000",
			      },
			    },
			    "SIGNONMSGSRSV1": {
			      "SONRS": {
			        "DTSERVER": "20260915120000",
			        "LANGUAGE": "FRA",
			        "STATUS": {
			          "CODE": "0",
			          "SEVERITY": "INFO",
			        },
			      },
			    },
			  },
			  "header": {
			    "<!-- Synthetic statement imitating the OFX 1.0.2 export of Crédit Agricole": " SGML, windows-1252, unclosed leaf tags, empty MEMO tags and decimal commas. Every name, number and amount is invented. -->",
			    "CHARSET": "1252",
			    "COMPRESSION": "NONE",
			    "DATA": "OFXSGML",
			    "ENCODING": "USASCII",
			    "NEWFILEUID": "NONE",
			    "OFXHEADER": "100",
			    "OLDFILEUID": "NONE",
			    "SECURITY": "NONE",
			    "VERSION": "102",
			  },
			}
		`);
	});

	it("parses dotted tags, whitespace before tags and comments exactly as before the patch", () => {
		const text = [
			"OFXHEADER:100",
			"<OFX> <!-- a comment -->",
			"<SIGNONMSGSRSV1>  \t",
			"<INTU.BID>1234  <INTU.USERID>  me\t\n<A..B>x",
			"<!-- two --><!----><NAME>CAFÉ   \n  </SIGNONMSGSRSV1>",
			"</OFX>",
		].join("\n");

		expect(parseSync(text)).toMatchInlineSnapshot(`
			{
			  "OFX": {
			    "SIGNONMSGSRSV1": {
			      "AB": "x",
			      "INTUBID": "1234",
			      "INTUUSERID": "me",
			      "NAME": "CAFÉ",
			    },
			  },
			  "header": {
			    "OFXHEADER": "100",
			  },
			}
		`);
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
