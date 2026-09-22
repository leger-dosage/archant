import type { IsoDate } from "../../domain/dates.ts";
import type {
	NormalizedTransaction,
	ParsedStatement,
	RejectionCode,
} from "../../domain/statement.ts";
import type { FileSource, FileSourceOptions } from "../file-source.ts";

import type { CurrencyCode, MinorUnits } from "@archant/data/money";
import { parseAmount } from "@archant/data/money";
import type { QifDateOrder } from "@archant/data/qif-options";

import { providerDate } from "../../domain/provider-date.ts";
import { AppError } from "../../lib/errors.ts";
import { LABEL_MAX_LENGTH, NOTES_MAX_LENGTH } from "../../schemas/transactions.ts";
import { decodeText } from "../decode.ts";
import { MAX_FILE_BYTES } from "../file-source.ts";

/** Longer than any cheque or transaction number a bank prints. */
export const REFERENCE_MAX_LENGTH = 50;

// Sections that hold lists rather than an account's movements: their records
// are categories, classes, memorised payees, securities, prices, tags,
// investment items or templates.
const LIST_TYPES = new Set([
	"cat",
	"class",
	"memorized",
	"security",
	"prices",
	"tag",
	"invitem",
	"template",
]);

// Enough for any type Quicken or Money writes; the refusal echoes it back.
const TYPE_MAX_LENGTH = 30;

const TRANSACTION_TYPES = new Set(["bank", "ccard"]);

// Quicken writes this payee on the record that sets the account's starting
// balance: a balance, not a movement, so it never becomes a transaction.
const OPENING_BALANCE = "opening balance";

function invalidFile(): AppError {
	return new AppError("INVALID_IMPORT_FILE", "The file is not a readable QIF statement.");
}

/** One transaction record: the first value of each field code it holds. */
type QifRecord = ReadonlyMap<string, string>;

type Section = "none" | "transactions" | "skipped";

/**
 * The records of the file's one transaction section, in order. Refuses a file
 * with no such section, with a type other than `Bank` or `CCard`, or with more
 * than one account or section: an import feeds one account, and guessing which
 * part of the file is that account's would put lines on the wrong one.
 */
function recordsOf(content: string): QifRecord[] {
	const records: QifRecord[] = [];
	let section: Section = "none";
	let sections = 0;
	let accounts = 0;
	// Between `!Option:AutoSwitch` and `!Clear:AutoSwitch`, Quicken lists every
	// account of the data file; that list says nothing about which account
	// the transactions below belong to.
	let accountList = false;
	let fields = new Map<string, string>();
	let open = false;

	const flush = () => {
		if (section === "transactions" && open) {
			records.push(fields);
		}

		fields = new Map();
		open = false;
	};

	for (const raw of content.replaceAll(/\r\n?/gu, "\n").split("\n")) {
		const line = raw.trim();

		if (line === "") {
			continue;
		}

		if (line.startsWith("!")) {
			flush();
			const header = line.toLowerCase();

			if (header.startsWith("!option:") || header.startsWith("!clear:")) {
				if (header.slice(header.indexOf(":") + 1).trim() === "autoswitch") {
					accountList = header.startsWith("!option:");
				}

				continue;
			}

			if (header.startsWith("!account")) {
				accounts += accountList ? 0 : 1;
				section = "skipped";
			} else if (header.startsWith("!type:")) {
				const type = Array.from(line.slice("!type:".length).trim())
					.slice(0, TYPE_MAX_LENGTH)
					.join("");

				if (type === "") {
					throw invalidFile();
				}

				if (TRANSACTION_TYPES.has(type.toLowerCase())) {
					sections += 1;
					section = "transactions";
				} else if (LIST_TYPES.has(type.toLowerCase())) {
					section = "skipped";
				} else {
					throw new AppError(
						"INVALID_IMPORT_FILE",
						`QIF statements of type ${type} are not supported.`,
						undefined,
						{ type },
					);
				}
			} else {
				// A header this parser does not know: its records are not movements.
				section = "skipped";
			}

			if (accounts > 1 || sections > 1) {
				throw invalidFile();
			}

			continue;
		}

		if (line === "^") {
			flush();
			continue;
		}

		const code = line.charAt(0);

		if (!fields.has(code)) {
			fields.set(code, line.slice(1));
		}

		open = true;
	}

	// A last record without its `^` is still a record.
	flush();

	if (sections === 0) {
		throw invalidFile();
	}

	return records;
}

function text(bytes: Uint8Array): string {
	if (bytes.length > MAX_FILE_BYTES) {
		throw invalidFile();
	}

	return decodeText(bytes);
}

const DATE_PARTS = /^(\d{1,4})[/.\-'](\d{1,2})[/.\-'](\d{1,4})$/u;

/**
 * A `D` field as `YYYY-MM-DD`; `null` when it is not a real day in `order`.
 * Quicken writes `1/ 5'24`: spaces go, and `'` separates the year like `/`.
 * A two-digit year is in this century, as for CSV. A leading four-digit year
 * reads year, month, day whatever the order.
 */
export function dateOf(field: string, order: QifDateOrder): IsoDate | null {
	const match = DATE_PARTS.exec(field.replaceAll(/\s/gu, ""));

	if (match === null) {
		return null;
	}

	const [, first = "", second = "", third = ""] = match;
	let parts: [string, string, string];

	if (first.length === 4 && third.length <= 2) {
		parts = [first, second, third];
	} else if (first.length > 2 || (third.length !== 2 && third.length !== 4)) {
		return null;
	} else {
		const year = third.length === 2 ? `20${third}` : third;

		parts = order === "day-first" ? [year, second, first] : [year, first, second];
	}

	return providerDate(parts.map((part) => part.padStart(2, "0")).join(""));
}

const AMOUNT = /^([-+−]?)(\d+(?:[.,]\d+)*)$/u;
const GROUPED = /^\d{1,3}(?<separator>[.,])\d{3}(?:\k<separator>\d{3})*$/u;

/**
 * A `T` or `U` field in minor units. The last `.` or `,` followed by one or
 * two digits to the end is the decimal mark; any other separator must split
 * groups of three digits. Files say `12,50`, `1,234.56` or `1.234,56`
 * depending on who wrote them, and none of them says which it is.
 */
export function amountOf(field: string, currency: CurrencyCode): MinorUnits | null {
	const match = AMOUNT.exec(field.replaceAll(/\s/gu, ""));

	if (match === null) {
		return null;
	}

	const [, sign = "", number = ""] = match;
	const decimal = /(?<mark>[.,])(?<fraction>\d{1,2})$/u.exec(number);
	const integer = decimal === null ? number : number.slice(0, decimal.index);
	const mark = decimal?.groups?.["mark"];
	const grouping = GROUPED.exec(integer)?.groups?.["separator"];

	if (!/^\d+$/u.test(integer) && (grouping === undefined || grouping === mark)) {
		return null;
	}

	const fraction = decimal?.groups?.["fraction"];
	const digits = integer.replaceAll(/[.,]/gu, "");

	return parseAmount(
		`${sign === "+" ? "" : sign}${digits}${fraction === undefined ? "" : `.${fraction}`}`,
		currency,
	);
}

/** Spaces collapsed, cut at `limit` code points so an emoji is never halved. */
function cleaned(value: string | undefined, limit: number): string {
	return Array.from((value ?? "").replace(/\s+/gu, " ").trim())
		.slice(0, limit)
		.join("");
}

function toLine(
	record: QifRecord,
	order: QifDateOrder,
	currency: CurrencyCode,
): NormalizedTransaction | RejectionCode {
	const payee = cleaned(record.get("P"), Number.POSITIVE_INFINITY);

	if (payee.toLowerCase() === OPENING_BALANCE) {
		return "OPENING_BALANCE";
	}

	const date = dateOf(record.get("D") ?? "", order);

	if (date === null) {
		return "INVALID_DATE";
	}

	const total = record.get("T");
	const amount = amountOf(
		total === undefined || total.trim() === "" ? (record.get("U") ?? "") : total,
		currency,
	);

	if (amount === null) {
		return "INVALID_AMOUNT";
	}

	const memo = cleaned(record.get("M"), Number.POSITIVE_INFINITY);
	const label = Array.from(payee === "" ? memo : payee)
		.slice(0, LABEL_MAX_LENGTH)
		.join("");

	if (label === "") {
		return "MISSING_LABEL";
	}

	const reference = cleaned(record.get("N"), REFERENCE_MAX_LENGTH);

	return {
		// Keys are the fingerprints (AD-7): a QIF record carries no stable id.
		externalId: null,
		date,
		amount,
		currency,
		label,
		reference: reference === "" ? null : reference,
		notes:
			payee === "" || memo === "" || memo === payee
				? null
				: Array.from(memo).slice(0, NOTES_MAX_LENGTH).join(""),
	};
}

/**
 * The order a file's dates are read in, when the user has not chosen: the one
 * that reads every date either order can read, `day-first` when both or
 * neither do.
 * `ambiguous` says both read every date and at least one differently, so only
 * the user can tell: a monthly statement almost always holds a day above 12,
 * which settles it.
 */
export function qifDateOrder(bytes: Uint8Array): {
	dateOrder: QifDateOrder;
	ambiguous: boolean;
} {
	return orderOf(recordsOf(text(bytes)));
}

function orderOf(records: readonly QifRecord[]): { dateOrder: QifDateOrder; ambiguous: boolean } {
	let dayFirst = true;
	let monthFirst = true;
	let differs = false;

	for (const record of records) {
		const field = record.get("D");
		const asDayFirst = field === undefined ? null : dateOf(field, "day-first");
		const asMonthFirst = field === undefined ? null : dateOf(field, "month-first");

		// A date neither order reads is rejected either way: it settles nothing.
		if (asDayFirst !== null || asMonthFirst !== null) {
			dayFirst &&= asDayFirst !== null;
			monthFirst &&= asMonthFirst !== null;
			differs ||= asDayFirst !== asMonthFirst;
		}
	}

	return {
		dateOrder: monthFirst && !dayFirst ? "month-first" : "day-first",
		ambiguous: dayFirst && monthFirst && differs,
	};
}

function parse(bytes: Uint8Array, options: FileSourceOptions): ParsedStatement {
	const records = recordsOf(text(bytes));
	const order = options.qif?.dateOrder ?? orderOf(records).dateOrder;
	const result: ParsedStatement = { transactions: [], balance: null, rejected: [] };

	for (const [index, record] of records.entries()) {
		const mapped = toLine(record, order, options.currency);

		if (typeof mapped === "string") {
			// The record's rank among the file's transactions, as for OFX.
			result.rejected.push({ ref: String(index), reason: mapped });
		} else {
			result.transactions.push(mapped);
		}
	}

	return result;
}

// Enough to hold the first header, after any blank lines a tool leaves.
const HEAD_BYTES = 1024;

const QIF_HEADER = /^(?:!type:|!account|!option:)/iu;

/**
 * Whether the file is QIF: by its name, or by its first line, since QIF has no
 * signature and some banks name it `.txt`.
 */
function detect(bytes: Uint8Array, fileName: string): boolean {
	if (/\.qif$/iu.test(fileName)) {
		return true;
	}

	const first = decodeText(bytes.subarray(0, HEAD_BYTES))
		.split(/\r\n?|\n/u)
		.map((line) => line.trim())
		.find((line) => line !== "");

	return first !== undefined && QIF_HEADER.test(first);
}

/** QIF bank and card statements, as Quicken, Microsoft Money and some banks export them. */
export const qifSource: FileSource = { id: "qif", detect, parse };
