import type {
	NormalizedTransaction,
	ParsedStatement,
	RejectionCode,
	StatementBalance,
} from "../../domain/statement.ts";
import type { FileSource, FileSourceOptions } from "../file-source.ts";

import { parseSync } from "ofx-js";
import { z } from "zod";

import type { MinorUnits } from "@archant/data/money";
import { minorUnitsOf, parseAmount } from "@archant/data/money";

import { providerDate } from "../../domain/provider-date.ts";
import { AppError } from "../../lib/errors.ts";
import { LABEL_MAX_LENGTH } from "../../schemas/transactions.ts";
import { decodeText } from "../decode.ts";
import { MAX_FILE_BYTES } from "../file-source.ts";

// Enough to hold the SGML header or the XML prologue of any bank's export.
const HEAD_BYTES = 1024;

// An SGML header `CHARSET:1252` or `CHARSET:ISO-8859-1`, or an XML prologue
// declaring either. ISO-8859-1 is read as windows-1252, as browsers do: the
// two agree on every letter a French label uses.
const DECLARES_1252 =
	/^\s*CHARSET:\s*(?:1252|(?:ISO-)?8859-1)\s*$|encoding\s*=\s*["'](?:windows-1252|ISO-8859-1)["']/imu;

function invalidFile(): AppError {
	return new AppError("INVALID_IMPORT_FILE", "The file is not a readable OFX statement.");
}

/** The start of the file as Latin-1, which maps every byte, for sniffing only. */
function head(bytes: Uint8Array): string {
	return new TextDecoder("latin1").decode(bytes.subarray(0, HEAD_BYTES));
}

/**
 * Closes the leaf tags an SGML export leaves empty, such as `<MEMO>` followed
 * by a line break: `ofx-js` otherwise takes the next tag for its child and
 * rejects the whole file. A tag counts as a leaf when the file never closes
 * it; aggregates such as `STMTTRN` are always closed.
 */
export function closeEmptyLeaves(text: string): string {
	const closed = new Set(Array.from(text.matchAll(/<\/([\w.]+)>/gu), (match) => match[1]));

	return text.replace(/<([\w.]+)>(?=\s*<)/gu, (tag, name: string) =>
		closed.has(name) ? tag : `<${name}></${name}>`,
	);
}

const leaf = z.string();

const line = z.object({
	FITID: leaf.optional(),
	DTPOSTED: leaf.optional(),
	TRNAMT: leaf.optional(),
	NAME: leaf.optional(),
	MEMO: leaf.optional(),
});

type RawLine = z.infer<typeof line>;

// `ofx-js` gives a lone child as an object and repeated ones as an array.
const lines = z.union([line.transform((one) => [one]), z.array(line)]);

// Several `STMTRS` or `STMTTRNRS` arrive as arrays and fail here: one file
// feeds one account, and guessing which statement is the account's is the
// account matching this story leaves out.
const statement = z.object({
	CURDEF: z.string().regex(/^[A-Z]{3}$/u),
	// An empty `<BANKTRANLIST>` has no child and reads as a string.
	BANKTRANLIST: z.union([z.object({ STMTTRN: lines.optional() }), z.literal("")]).optional(),
	// Anything unexpected here reads as no balance: the lines stay importable.
	LEDGERBAL: z.unknown().optional(),
});

const ledgerBalance = z.object({ BALAMT: leaf.optional(), DTASOF: leaf.optional() });

const document = z.object({
	OFX: z.object({
		BANKMSGSRSV1: z.object({ STMTTRNRS: z.object({ STMTRS: statement }) }).optional(),
		CREDITCARDMSGSRSV1: z.object({ CCSTMTTRNRS: z.object({ CCSTMTRS: statement }) }).optional(),
	}),
});

/** Trimmed, with every run of spaces, tabs or line breaks made one space. */
function clean(text: string | undefined): string {
	return (text ?? "").replace(/\s+/gu, " ").trim();
}

/**
 * The label from `NAME` and `MEMO`. Banks often repeat one inside the other,
 * or leave one empty; only two different texts are joined.
 */
export function labelOf(name: string | undefined, memo: string | undefined): string {
	const first = clean(name);
	const second = clean(memo);

	if (second === "" || first.includes(second)) {
		return first;
	}

	if (first === "" || second.includes(first)) {
		return second;
	}

	return `${first} ${second}`;
}

/**
 * `TRNAMT` in minor units: a decimal point or comma, the sign kept (AD-5).
 * Some banks drop the leading zero (`.50`, `-.99`) or pad the fraction
 * (`12.500`); zeros past the currency's decimals change nothing, any other
 * digit there still makes the amount invalid.
 */
function amountOf(text: string | undefined, options: FileSourceOptions): MinorUnits | null {
	const decimals = minorUnitsOf(options.currency);
	const normalized = clean(text)
		.replace(/^\+/u, "")
		.replace(/^(-?)(?=[.,])/u, (_match, sign: string) => `${sign}0`)
		.replace(/([.,]\d*?)(0+)$/u, (_match, kept: string, zeros: string) => {
			const excess = Math.min(zeros.length, Math.max(0, kept.length - 1 + zeros.length - decimals));
			const rest = kept + zeros.slice(0, zeros.length - excess);

			// A separator left alone, as in `1200.00` in yen, goes too.
			return rest.length === 1 ? "" : rest;
		});

	return parseAmount(normalized, options.currency);
}

function toLine(
	raw: RawLine,
	currency: string,
	options: FileSourceOptions,
): NormalizedTransaction | RejectionCode {
	const date = providerDate(clean(raw.DTPOSTED));

	if (date === null) {
		return "INVALID_DATE";
	}

	const amount = amountOf(raw.TRNAMT, options);

	if (amount === null) {
		return "INVALID_AMOUNT";
	}

	const label = labelOf(raw.NAME, raw.MEMO);

	if (label === "") {
		return "MISSING_LABEL";
	}

	const fitid = clean(raw.FITID);

	return {
		externalId: fitid === "" ? null : fitid,
		date,
		amount,
		currency,
		// By code points, so an emoji at the limit is never cut in half.
		label: Array.from(label).slice(0, LABEL_MAX_LENGTH).join(""),
		reference: null,
		notes: null,
	};
}

/**
 * `LEDGERBAL`, the booked balance the statement closes on, signed as the bank
 * prints it. `null` when absent or when its amount or date cannot be read;
 * the file stays valid. `AVAILBAL` is left out: it counts pending card
 * payments the lines do not hold yet.
 */
function balanceOf(
	raw: unknown,
	currency: string,
	options: FileSourceOptions,
): StatementBalance | null {
	const parsed = ledgerBalance.safeParse(raw);

	if (!parsed.success) {
		return null;
	}

	const amount = amountOf(parsed.data.BALAMT, options);
	const date = providerDate(clean(parsed.data.DTASOF));

	return amount === null || date === null ? null : { amount, currency, date };
}

function parse(bytes: Uint8Array, options: FileSourceOptions): ParsedStatement {
	if (bytes.length > MAX_FILE_BYTES) {
		throw invalidFile();
	}

	const declared = DECLARES_1252.test(head(bytes)) ? "windows-1252" : undefined;
	let raw: unknown;

	try {
		raw = parseSync(closeEmptyLeaves(decodeText(bytes, declared)));
	} catch {
		throw invalidFile();
	}

	const parsed = document.safeParse(raw);

	if (!parsed.success) {
		throw invalidFile();
	}

	const bank = parsed.data.OFX.BANKMSGSRSV1?.STMTTRNRS.STMTRS;
	const card = parsed.data.OFX.CREDITCARDMSGSRSV1?.CCSTMTTRNRS.CCSTMTRS;
	const only = bank ?? card;

	if (only === undefined || (bank !== undefined && card !== undefined)) {
		throw invalidFile();
	}

	const list = typeof only.BANKTRANLIST === "object" ? (only.BANKTRANLIST.STMTTRN ?? []) : [];
	const result: ParsedStatement = {
		transactions: [],
		balance: balanceOf(only.LEDGERBAL, only.CURDEF, options),
		rejected: [],
	};

	for (const [index, rawLine] of list.entries()) {
		const mapped = toLine(rawLine, only.CURDEF, options);

		if (typeof mapped === "string") {
			result.rejected.push({ ref: String(index), reason: mapped });
		} else {
			result.transactions.push(mapped);
		}
	}

	return result;
}

/** OFX 1.x (SGML) and 2.x (XML) bank and card statements. */
export const ofxSource: FileSource = {
	id: "ofx",
	detect: (bytes, fileName) =>
		/\.(?:ofx|qfx)$/iu.test(fileName) || /OFXHEADER|<OFX>/u.test(head(bytes)),
	parse,
};
