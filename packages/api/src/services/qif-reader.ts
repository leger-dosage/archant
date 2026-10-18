import type { IsoDate } from "../domain/dates.ts";

import { AppError } from "../lib/errors.ts";
import { strptime } from "./csv-import-format.ts";

// Sure's `QifParser` at 00dd977fb: a Quicken file's sections, the account
// each one belongs to, its records with their category, tags and split
// lines, its investment records and their securities. Pure: the fields stay
// the file's text, read with the format the user chooses afterwards.

/** Sure's `TRANSACTION_TYPES`, as the file spells them. */
const TRANSACTION_TYPES = ["CCard", "Bank", "Cash", "Invst", "Oth L", "Oth A"] as const;

type QifSectionType = (typeof TRANSACTION_TYPES)[number];

/** Sure's `BUY_LIKE_ACTIONS` and `SELL_LIKE_ACTIONS`: the records that are trades. */
export const BUY_ACTIONS: readonly string[] = ["Buy", "ReinvDiv", "Cover"];
export const SELL_ACTIONS: readonly string[] = ["Sell", "ShtSell"];

/** Sure's `INFLOW_TRANSACTION_ACTIONS`: cash entering the investment account. */
export const INFLOW_ACTIONS: readonly string[] = [
	"Div",
	"IntInc",
	"XIn",
	"CGLong",
	"CGShort",
	"MiscInc",
];

type QifAccount = { name: string; type: string | null };

/** One `S`, `$`, `E` group of a split record. */
export type QifSplit = { category: string; tags: string[]; amount: string; memo: string };

type Common = {
	/** The `D` field as written. */
	date: string;
	/** The `T` field, else `U`, as written. */
	amount: string;
	payee: string;
	memo: string;
	category: string;
	tags: string[];
	/** The `!Account` above the section, `null` when none. */
	account: QifAccount | null;
	/** The account's `T` type, else the section's. */
	type: string;
};

type QifTransaction = Common & { kind: "transaction"; splits: QifSplit[] };

type QifInvestment = Common & {
	kind: "investment";
	action: string;
	security: string;
	/** The security's `S` ticker in a `!Type:Security` section, else its name. */
	ticker: string;
	price: string;
	quantity: string;
};

/** A section's « Opening Balance » record, the starting balance of its account. */
type QifOpening = { account: string | null; date: string; amount: string };

export type QifFile = {
	/** Every account the file names, Sure's `parse_accounts`. */
	accounts: QifAccount[];
	/** The first transaction section's type, Sure's `account_type`. */
	firstType: string | null;
	transactions: QifTransaction[];
	investments: QifInvestment[];
	openings: QifOpening[];
	/** Every `D` field of a transaction section, normalised, Sure's `extract_raw_dates`. */
	dates: string[];
};

/** One record: its last value per field code, and its split groups in order. */
type QifRecord = {
	fields: Map<string, string>;
	splits: { category: string; amount: string; memo: string }[];
};

type Section =
	| { kind: "account" }
	| { kind: "transactions"; type: QifSectionType; account: QifAccount | null }
	| { kind: "security" }
	| { kind: "skipped" };

/** Sure's `"Must be a valid QIF file"`: no `!Type:` header anywhere. */
const invalid = () => new AppError("QIF_INVALID", "The file must be a valid QIF file.");

const field = (record: QifRecord, code: string) => record.fields.get(code) ?? "";

const OPENING_BALANCE = "opening balance";

/**
 * Sure's `parse_category_and_tags`: `Category/Tag:Tag`, nothing for a
 * transfer `[Account]` or Quicken's `--Split--` placeholder.
 */
export function categoryAndTags(value: string): { category: string; tags: string[] } {
	const trimmed = value.trim();

	if (trimmed === "" || trimmed.startsWith("[") || /^--split--$/iu.test(trimmed)) {
		return { category: "", tags: [] };
	}

	const at = value.indexOf("/");

	if (at === -1) {
		return { category: trimmed, tags: [] };
	}

	return {
		category: value.slice(0, at).trim(),
		tags: value
			.slice(at + 1)
			.split(":")
			.map((tag) => tag.trim())
			.filter((tag) => tag !== ""),
	};
}

/**
 * Sure's `normalize_qif_date`: Quicken's `'` year separator replaced by the
 * date's own, spaces dropped from a numeric date and collapsed in one with a
 * month name, a two-digit year read in this century unless that passes
 * `today`'s year.
 */
export function normalizeQifDate(text: string, today: IsoDate): string {
	let date = text.trim();

	if (date.includes("'")) {
		date = date.replaceAll("'", /[/.-]/u.exec(date)?.[0] ?? "/");
	}

	date = /[a-z]/iu.test(date) ? date.replaceAll(/\s+/gu, " ").trim() : date.replaceAll(/\s+/gu, "");

	const short = /^(.+[/. -])(\d{2})$/u.exec(date);

	if (!/\d{4}/u.test(date) && short !== null) {
		const year = 2000 + Number(short[2]);

		date = `${short[1]}${year > Number(today.slice(0, 4)) ? year - 100 : year}`;
	}

	return date;
}

/** Sure's `try_parse_date`: a `D` field read with `format`, `null` when it does not read. */
export const qifDateOf = (text: string, format: string, today: IsoDate): IsoDate | null =>
	strptime(normalizeQifDate(text, today), format);

/**
 * An `I` or `Q` field as decimal text: commas strip as Sure's
 * `parse_qif_amount`, unless the field writes a French decimal comma: the
 * last mark when a dot comes before it (`1.234,5678`), or a lone comma that
 * splits no group of three digits (`10,5`); `1,000` is a thousand.
 */
export function qifDecimalOf(text: string): string | null {
	const compact = text.replaceAll(/\s/gu, "");
	const french =
		/^[-+]?\d{1,3}(?:\.\d{3})+,\d+$/u.test(compact) ||
		(/^[-+]?\d+,\d+$/u.test(compact) && !/^[-+]?\d{1,3},\d{3}$/u.test(compact));
	const decimal = french
		? compact.replaceAll(".", "").replace(",", ".")
		: compact.replaceAll(",", "");

	return /^[-+]?\d+(?:\.\d*)?$/u.test(decimal)
		? decimal.replace(/^\+/u, "").replace(/\.$/u, "")
		: null;
}

function sectionTypeOf(name: string): QifSectionType | undefined {
	return TRANSACTION_TYPES.find((type) => type.toLowerCase() === name.trim().toLowerCase());
}

/**
 * The file's sections and records, as Sure's `transaction_sections` reads
 * them: an `!Account` block names the account of the sections below it, by
 * its first record; `!Type:Security` blocks name tickers; any other header
 * holds no movement.
 */
export function readQif(text: string, today: IsoDate): QifFile {
	if (!/^!type:/imu.test(text)) {
		throw invalid();
	}

	const accounts: QifAccount[] = [];
	const tickers = new Map<string, string>();
	const sections: { type: QifSectionType; account: QifAccount | null; records: QifRecord[] }[] = [];
	let section: Section = { kind: "skipped" };
	let current: QifAccount | null = null;
	let blockHasAccount = false;
	let record: QifRecord = { fields: new Map(), splits: [] };
	let records: QifRecord[] = [];

	const flush = () => {
		if (record.fields.size > 0 || record.splits.length > 0) {
			if (section.kind === "account") {
				const name = field(record, "N").trim();

				if (name !== "") {
					const account = { name, type: field(record, "T").trim() || null };

					accounts.push(account);

					// The first account of a block names the sections below it.
					if (!blockHasAccount) {
						current = account;
						blockHasAccount = true;
					}
				}
			} else if (section.kind === "security") {
				const name = field(record, "N").trim();
				const ticker = field(record, "S").trim();

				if (name !== "" && ticker !== "") {
					tickers.set(name, ticker);
				}
			} else if (section.kind === "transactions") {
				records.push(record);
			}
		}

		record = { fields: new Map(), splits: [] };
	};

	const close = () => {
		flush();

		if (section.kind === "transactions") {
			sections.push({ type: section.type, account: section.account, records });
		}

		records = [];
	};

	for (const raw of text.replaceAll(/\r\n?/gu, "\n").split("\n")) {
		const line = raw.trimEnd();

		if (line.trim() === "") {
			continue;
		}

		if (/^!account/iu.test(line)) {
			close();
			section = { kind: "account" };
			current = null;
			blockHasAccount = false;
			continue;
		}

		const header = /^!type:(.*)$/iu.exec(line);

		if (header !== null) {
			close();
			const name = header[1] ?? "";
			const type = sectionTypeOf(name);

			section =
				type !== undefined
					? { kind: "transactions", type, account: current }
					: name.trim().toLowerCase() === "security"
						? { kind: "security" }
						: { kind: "skipped" };
			continue;
		}

		// `!Option:AutoSwitch` and its kin say nothing of the records.
		if (line.startsWith("!")) {
			continue;
		}

		if (line.trim() === "^") {
			flush();
			continue;
		}

		const code = line.charAt(0);
		const value = line.slice(1).trim();

		if (code === "S") {
			record.splits.push({ category: value, amount: "", memo: "" });
		} else if (code === "$" || code === "E") {
			const last = record.splits.at(-1);

			if (last !== undefined) {
				last[code === "$" ? "amount" : "memo"] = value;
			}
		}

		record.fields.set(code, value);
	}

	close();

	const transactions: QifTransaction[] = [];
	const investments: QifInvestment[] = [];
	const openings: QifOpening[] = [];
	const dates: string[] = [];

	for (const { type, account, records: sectionRecords } of sections) {
		const accountType = account?.type ?? type;
		let opened = false;

		for (const item of sectionRecords) {
			const date = field(item, "D");
			const amount = field(item, "T") || field(item, "U");
			const payee = field(item, "P");

			if (date !== "") {
				dates.push(normalizeQifDate(date, today));
			}

			// Sure's `build_transaction` drops it; an investment record keeps it.
			if (type !== "Invst" && payee.trim().toLowerCase() === OPENING_BALANCE) {
				if (!opened && date !== "" && amount !== "") {
					openings.push({ account: account?.name ?? null, date, amount });
					opened = true;
				}

				continue;
			}

			const { category, tags } = categoryAndTags(field(item, "L"));
			const common = {
				date,
				amount,
				payee: payee.trim(),
				memo: field(item, "M").trim(),
				category,
				tags,
				account,
				type: accountType,
			};

			if (type === "Invst") {
				const action = field(item, "N").trim();

				if (action !== "" && date !== "") {
					const security = field(item, "Y").trim();

					investments.push({
						...common,
						kind: "investment",
						action,
						security,
						ticker: tickers.get(security) ?? security,
						price: field(item, "I"),
						quantity: field(item, "Q"),
					});
				}
			} else if (date !== "" && amount !== "") {
				transactions.push({
					...common,
					kind: "transaction",
					splits: item.splits.flatMap((split) =>
						split.amount === ""
							? []
							: [{ ...categoryAndTags(split.category), amount: split.amount, memo: split.memo }],
					),
				});
			}
		}
	}

	return {
		accounts,
		firstType: sections[0]?.type ?? null,
		transactions,
		investments,
		openings,
		dates,
	};
}
