import type { IsoDate } from "../domain/dates.ts";
import type { ServiceDeps } from "./deps.ts";

import { z } from "zod";

import type { MinorUnits } from "@archant/data/money";
import { parseDecimalAmount } from "@archant/data/money";
import { categories } from "@archant/data/schema/categories";
import { merchants } from "@archant/data/schema/merchants";
import { tags } from "@archant/data/schema/tags";

import { AppError } from "../lib/errors.ts";
import { EARLIEST_OPENING_DATE } from "../schemas/accounts.ts";

// Sure's `SureImport` and `SureImport::Preflight` at 00dd977fb: the checks
// it runs on an `all.ndjson` before `Family::DataImporter` merges it, in its
// order and with its codes. `sure-import-plan.ts` adds Archant's own
// refusals beside them and reads what Archant keeps into a plan.

/** Sure's `IMPORTABLE_NDJSON_TYPES`: what « Résumé de l'importation » counts, in its order. */
const IMPORTABLE_TYPES = {
	Account: "accounts",
	Balance: "balances",
	Category: "categories",
	Tag: "tags",
	Merchant: "merchants",
	RecurringTransaction: "recurring_transactions",
	Transaction: "transactions",
	Transfer: "transfers",
	RejectedTransfer: "rejected_transfers",
	Trade: "trades",
	Holding: "holdings",
	Valuation: "valuations",
	Budget: "budgets",
	BudgetCategory: "budget_categories",
	Rule: "rules",
} as const;

type SureCountKey = (typeof IMPORTABLE_TYPES)[keyof typeof IMPORTABLE_TYPES];

export type SureCounts = Record<SureCountKey, number>;

/** `Family::DataImporter::SUPPORTED_TYPES`: any other type is refused. */
const SUPPORTED_TYPES = new Set([
	"Account",
	"Balance",
	"Category",
	"Tag",
	"Merchant",
	"ProviderMerchant",
	"RecurringTransaction",
	"RecurrenceRule",
	"RecurringOccurrence",
	"RecurringAllocation",
	"RecurringPriceChange",
	"RecurringMatchRejection",
	"Transaction",
	"Transfer",
	"RejectedTransfer",
	"Trade",
	"Holding",
	"Valuation",
	"Budget",
	"BudgetCategory",
	"Rule",
]);

/** Sure's `REQUIRED_FIELDS`. */
const REQUIRED_FIELDS: Record<string, readonly string[]> = {
	Account: ["id", "name", "balance", "accountable_type"],
	Balance: ["account_id", "date", "balance"],
	Category: ["id", "name"],
	Tag: ["id", "name"],
	Merchant: ["id", "name"],
	ProviderMerchant: ["id", "name", "source"],
	RecurringTransaction: [
		"id",
		"amount",
		"expected_day_of_month",
		"last_occurrence_date",
		"next_expected_date",
	],
	Transaction: ["id", "account_id", "date", "amount"],
	Transfer: ["inflow_transaction_id", "outflow_transaction_id"],
	RejectedTransfer: ["inflow_transaction_id", "outflow_transaction_id"],
	Trade: ["account_id", "date", "amount", "qty", "price", "ticker"],
	Holding: ["account_id", "date", "amount", "qty", "price", "ticker"],
	Valuation: ["account_id", "date", "amount"],
	Budget: ["id", "start_date", "end_date"],
	BudgetCategory: ["budget_id", "category_id"],
	Rule: ["id"],
};

type Namespace =
	| "accounts"
	| "categories"
	| "tags"
	| "merchants"
	| "recurring_transactions"
	| "transactions"
	| "budgets";

/** Sure's `TAXONOMY_TYPES`. */
const TAXONOMY_TYPES = {
	Category: { namespace: "categories", table: categories },
	Tag: { namespace: "tags", table: tags },
	Merchant: { namespace: "merchants", table: merchants },
} as const;

/** Sure's `SOURCE_ID_TYPES`: whose `id` other lines point at. */
const SOURCE_ID_TYPES: Record<string, Namespace> = {
	Category: "categories",
	Tag: "tags",
	Merchant: "merchants",
	ProviderMerchant: "merchants",
	Account: "accounts",
	RecurringTransaction: "recurring_transactions",
	Transaction: "transactions",
	Budget: "budgets",
};

/** Sure's `REFERENCE_FIELDS`. */
const REFERENCE_FIELDS: Record<string, readonly (readonly [Namespace, string])[]> = {
	Balance: [["accounts", "account_id"]],
	Category: [["categories", "parent_id"]],
	RecurringTransaction: [
		["accounts", "account_id"],
		["merchants", "merchant_id"],
	],
	Transaction: [
		["accounts", "account_id"],
		["categories", "category_id"],
		["merchants", "merchant_id"],
	],
	Transfer: [
		["transactions", "inflow_transaction_id"],
		["transactions", "outflow_transaction_id"],
	],
	RejectedTransfer: [
		["transactions", "inflow_transaction_id"],
		["transactions", "outflow_transaction_id"],
	],
	Trade: [["accounts", "account_id"]],
	Holding: [["accounts", "account_id"]],
	Valuation: [["accounts", "account_id"]],
	BudgetCategory: [
		["budgets", "budget_id"],
		["categories", "category_id"],
	],
};

/** Sure's `SOFT_REFERENCE_TYPES` and `SOFT_REFERENCE_FIELDS`: a warning, the row skipped or kept without it. */
const SOFT_REFERENCE_TYPES = new Set(["RejectedTransfer"]);
const SOFT_REFERENCE_FIELDS: Record<string, readonly string[]> = {
	Transaction: ["merchant_id"],
	RecurringTransaction: ["merchant_id"],
	"Transaction split line": ["merchant_id"],
};

/**
 * One finding: a snake_case code the interface translates and the values
 * its sentence names, never an amount (AD-14).
 */
export type SureIssue = { code: string; params: Record<string, string> };

/** An archive's read: Sure's counts, its errors and warnings. */
export type SurePreflight = { counts: SureCounts; errors: SureIssue[]; warnings: SureIssue[] };

export type Data = Record<string, unknown>;

/** A line of the archive Sure supports, with its 1-based line number. */
export type Line = { line: number; type: string; data: Data };

export type SureImportLimits = {
	/** `SURE_IMPORT_MAX_NDJSON_SIZE_MB`, in bytes. */
	maxBytes: number;
	/** `SURE_IMPORT_MAX_ROWS`. */
	maxRows: number;
};

// --- Reading values as Ruby reads them ----------------------------------

export const isData = (value: unknown): value is Data =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** Rails' `blank?`. */
export function isBlank(value: unknown): boolean {
	return (
		value === null ||
		value === undefined ||
		value === false ||
		(typeof value === "string" && value.trim() === "") ||
		(Array.isArray(value) && value.length === 0) ||
		(isData(value) && Object.keys(value).length === 0)
	);
}

/** An id as Ruby's `to_s` compares it; `null` when blank. */
export function idOf(value: unknown): string | null {
	if (isBlank(value)) {
		return null;
	}

	return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

/** Ruby's `inspect` of a scalar, as Sure's messages quote a value. */
export const inspect = (value: unknown): string => JSON.stringify(value) ?? "nil";

/** A text, `null` when blank or not a string. */
export function textOf(value: unknown): string | null {
	return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** `ActiveModel::Type::Boolean#cast`, `fallback` when absent. */
export function booleanOf(value: unknown, fallback: boolean): boolean {
	if (value === undefined || value === null || value === "") {
		return fallback;
	}

	return !(
		value === false ||
		value === 0 ||
		(typeof value === "string" && ["0", "f", "false", "off"].includes(value.toLowerCase()))
	);
}

/** A decimal as its text: Rails writes a `BigDecimal` as a string, a hand-built file may write a number. */
export function decimalText(value: unknown): string | null {
	if (typeof value === "string") {
		return value.trim();
	}

	return typeof value === "number" && Number.isFinite(value) ? String(value) : null;
}

export function amountOf(value: unknown, currency: string): MinorUnits | null {
	const text = decimalText(value);

	return text === null ? null : parseDecimalAmount(text, currency);
}

const isoDateSchema = z.iso.date();

/** An ISO date Archant keeps a balance for: not before 1900. */
export function dateOf(value: unknown): IsoDate | null {
	return typeof value === "string" &&
		isoDateSchema.safeParse(value).success &&
		value >= EARLIEST_OPENING_DATE
		? value
		: null;
}

/** Ruby's `Array(value)`. */
export function arrayOf(value: unknown): unknown[] {
	if (value === null || value === undefined) {
		return [];
	}

	return Array.isArray(value) ? value : [value];
}

/** Sure's `split_lines_value`. */
export function splitLinesOf(data: Data): unknown {
	for (const key of ["split_lines", "splitLines", "splits"]) {
		if (!isBlank(data[key])) {
			return data[key];
		}
	}

	return undefined;
}

/** Sure's `split_line_amount`. */
export function splitAmountOf(line: Data): unknown {
	return line.amount ?? line.amount_money ?? line.amount_decimal;
}

export const archantOf = (data: Data): Data => (isData(data.archant) ? data.archant : {});

export const oneOf = <Value extends string>(
	values: readonly Value[],
	value: unknown,
): Value | null => values.find((candidate) => candidate === value) ?? null;

/** A name as `assertNameFree` compares it, its ends trimmed as the import writes it. */
export const foldName = (name: string) => name.trim().toLocaleLowerCase("fr");

// --- The file itself ------------------------------------------------------

/** One parsed line: a JSON object, anything else, or text that is no JSON. */
type ParsedLine = { line: number; record: unknown } | { line: number; invalid: true };

function parsedLines(content: string): ParsedLine[] {
	return content.split("\n").flatMap((text, index): ParsedLine[] => {
		if (text.trim() === "") {
			return [];
		}

		try {
			return [{ line: index + 1, record: JSON.parse(text) as unknown }];
		} catch {
			return [{ line: index + 1, invalid: true }];
		}
	});
}

/** Whether a record is Sure's line: an object with a `type` and a `data` key. */
const isTypedRecord = (record: unknown): record is { type: unknown; data: unknown } =>
	isData(record) && !isBlank(record.type) && Object.hasOwn(record, "data");

/**
 * The file as UTF-8, as Sure reads it, or refused: decoded leniently, a
 * Latin-1 file would land with U+FFFD in every accented label.
 */
function utf8Of(bytes: Uint8Array): string {
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		throw notNdjson();
	}
}

const notNdjson = () =>
	new AppError("NDJSON_INVALID", "The file must be valid NDJSON with at least one record.");

/**
 * Refuses, before anything is read, what Sure refuses before it stores an
 * upload: a name other than `.ndjson` or `.json`, an empty file, a first
 * line that is not a JSON object with `type` and `data` (Sure's
 * `valid_ndjson_first_line?`, from the first line holding anything), and
 * more lines carrying a `type` than `maxRows` (Sure's
 * `MaxRowCountExceededError`). Returns the parsed lines.
 */
function checkFile(
	file: { name: string; bytes: Uint8Array },
	limits: SureImportLimits,
): ParsedLine[] {
	if (file.bytes.length > limits.maxBytes) {
		throw tooLarge(limits);
	}

	if (!/\.(?:nd)?json$/iu.test(file.name)) {
		throw notNdjson();
	}

	const lines = parsedLines(utf8Of(file.bytes));
	const [first] = lines;

	if (first === undefined || "invalid" in first || !isTypedRecord(first.record)) {
		throw notNdjson();
	}

	const typed = lines.filter((line) => "record" in line && isTypedRecord(line.record)).length;

	if (typed > limits.maxRows) {
		throw new AppError(
			"IMPORT_TOO_MANY_ROWS",
			`The file has more than ${limits.maxRows} records.`,
			undefined,
			{ max: String(limits.maxRows) },
		);
	}

	return lines;
}

/** `IMPORT_FILE_TOO_LARGE`, its limit in megabytes. */
export function tooLarge(limits: SureImportLimits): AppError {
	const maxSize = String(Math.floor(limits.maxBytes / (1024 * 1024)));

	return new AppError(
		"IMPORT_FILE_TOO_LARGE",
		`The file is larger than ${maxSize} MB.`,
		undefined,
		{ maxSize },
	);
}

// --- Sure's preflight ------------------------------------------------------

export type Findings = { errors: SureIssue[]; warnings: SureIssue[] };

export const issue = (code: string, params: Record<string, string> = {}): SureIssue => ({
	code,
	params,
});

export type Parsed = {
	records: Map<string, Line[]>;
	counts: Map<string, number>;
	sourceIds: Map<Namespace, Map<string, string[]>>;
};

export const recordsOf = (parsed: Parsed, type: string): Line[] => parsed.records.get(type) ?? [];

/** Sure's `parse_records`: line errors, counts and the ids lines point at. */
function parseRecords(lines: readonly ParsedLine[], findings: Findings): Parsed {
	const parsed: Parsed = { records: new Map(), counts: new Map(), sourceIds: new Map() };
	const track = (namespace: Namespace, id: string, location: string) => {
		const ids = parsed.sourceIds.get(namespace) ?? new Map<string, string[]>();
		ids.set(id, [...(ids.get(id) ?? []), location]);
		parsed.sourceIds.set(namespace, ids);
	};

	for (const entry of lines) {
		const line = String(entry.line);

		if ("invalid" in entry) {
			findings.errors.push(issue("invalid_json", { line }));
			continue;
		}

		const { record } = entry;

		if (!isTypedRecord(record)) {
			findings.errors.push(issue("invalid_ndjson_record", { line }));
			continue;
		}

		const type = String(record.type);
		parsed.counts.set(type, (parsed.counts.get(type) ?? 0) + 1);

		if (!SUPPORTED_TYPES.has(type)) {
			findings.errors.push(issue("unsupported_record_type", { line, type }));
			continue;
		}

		if (!isData(record.data)) {
			findings.errors.push(issue("invalid_ndjson_record", { line }));
			continue;
		}

		const data = record.data;
		const records = parsed.records.get(type) ?? [];
		records.push({ line: entry.line, type, data });
		parsed.records.set(type, records);
		const namespace = SOURCE_ID_TYPES[type];
		const id = idOf(data.id);

		if (namespace !== undefined && id !== null) {
			track(namespace, id, line);
		}

		const splitLines = type === "Transaction" ? splitLinesOf(data) : undefined;

		if (Array.isArray(splitLines)) {
			for (const split of splitLines) {
				const splitId = isData(split) ? idOf(split.id) : null;

				if (splitId !== null) {
					track("transactions", splitId, line);
				}
			}
		}
	}

	return parsed;
}

/** The names of each taxonomy table, folded as `assertNameFree` compares them. */
async function existingNames(
	deps: ServiceDeps,
): Promise<Record<keyof typeof TAXONOMY_TYPES, Set<string>>> {
	const read = async (table: (typeof TAXONOMY_TYPES)[keyof typeof TAXONOMY_TYPES]["table"]) =>
		new Set(
			(await deps.db.select({ name: table.name }).from(table)).map((row) => foldName(row.name)),
		);

	return {
		Category: await read(categories),
		Tag: await read(tags),
		Merchant: await read(merchants),
	};
}

/**
 * Sure's `validate_taxonomy_collisions` and `validate_duplicate_taxonomy_names`,
 * names folded as Archant compares them: a name the household holds is
 * reused, a warning; one the file gives twice is an error.
 */
function checkTaxonomy(
	parsed: Parsed,
	existing: Record<keyof typeof TAXONOMY_TYPES, Set<string>>,
	findings: Findings,
): void {
	for (const type of ["Category", "Tag", "Merchant"] as const) {
		for (const record of recordsOf(parsed, type)) {
			const name = textOf(record.data.name);

			if (name !== null && existing[type].has(foldName(name))) {
				findings.warnings.push(
					issue("existing_taxonomy_collision", {
						line: String(record.line),
						type,
						name: name.trim(),
					}),
				);
			}
		}
	}

	for (const type of ["Category", "Tag", "Merchant"] as const) {
		const byName = new Map<string, { name: string; lines: number[] }>();

		for (const record of recordsOf(parsed, type)) {
			const name = textOf(record.data.name);

			if (name !== null) {
				const group = byName.get(foldName(name)) ?? { name: name.trim(), lines: [] };
				group.lines.push(record.line);
				byName.set(foldName(name), group);
			}
		}

		for (const { name, lines } of byName.values()) {
			if (lines.length > 1) {
				findings.errors.push(
					issue("duplicate_taxonomy_name", { type, name, lines: lines.join(", ") }),
				);
			}
		}
	}
}

/** Sure's `validate_duplicate_source_ids`. */
function checkSourceIds(parsed: Parsed, findings: Findings): void {
	for (const [namespace, ids] of parsed.sourceIds) {
		for (const [id, lines] of ids) {
			if (lines.length > 1) {
				findings.errors.push(
					issue("duplicate_source_id", { kind: namespace, id, lines: lines.join(", ") }),
				);
			}
		}
	}
}

/** Sure's `validate_required_fields`. */
function checkRequiredFields(parsed: Parsed, findings: Findings): void {
	for (const [type, records] of parsed.records) {
		for (const record of records) {
			const missing = (REQUIRED_FIELDS[type] ?? []).filter((field) => isBlank(record.data[field]));

			if (missing.length > 0) {
				findings.errors.push(
					issue("missing_required_fields", {
						line: String(record.line),
						type,
						fields: missing.join(", "),
					}),
				);
			}
		}
	}
}

/** Exact decimal text as scaled integers, so `0.1 + 0.2` is `0.3`, as Ruby's `BigDecimal`. */
function decimalSum(texts: readonly string[]): string | null {
	const pattern = /^(-)?(\d+)(?:\.(\d+))?$/u;
	const parts = texts.map((text) => pattern.exec(text));

	if (parts.some((part) => part === null)) {
		return null;
	}

	const scale = Math.max(0, ...parts.map((part) => part?.[3]?.length ?? 0));
	const total = parts.reduce((sum, part) => {
		const value = BigInt(`${part?.[2] ?? "0"}${(part?.[3] ?? "").padEnd(scale, "0")}`);

		return sum + (part?.[1] === undefined ? value : -value);
	}, 0n);

	return `${total}/${scale}`;
}

/** Sure's `validate_split_lines`; amounts are compared exactly and never named (AD-14). */
function checkSplitLines(parsed: Parsed, findings: Findings): void {
	for (const record of recordsOf(parsed, "Transaction")) {
		const lines = splitLinesOf(record.data);
		const line = String(record.line);

		if (lines === undefined) {
			continue;
		}

		if (!Array.isArray(lines)) {
			findings.errors.push(issue("invalid_split_lines", { line }));
			continue;
		}

		let complete = true;

		for (const [index, split] of lines.entries()) {
			if (!isData(split)) {
				findings.errors.push(issue("invalid_split_line", { line, index: String(index + 1) }));
				complete = false;
			} else if (isBlank(splitAmountOf(split))) {
				findings.errors.push(
					issue("missing_required_fields", {
						line,
						type: `Transaction split line ${index + 1}`,
						fields: "amount",
					}),
				);
				complete = false;
			}
		}

		const total = decimalText(record.data.amount);

		if (!complete || total === null || total === "") {
			continue;
		}

		const amounts = lines.map((split) =>
			isData(split) ? decimalText(splitAmountOf(split)) : null,
		);
		const parent = decimalSum([total]);
		const sum = amounts.some((amount) => amount === null)
			? null
			: decimalSum(amounts.filter((amount) => amount !== null));

		if (parent === null || sum === null || !sameDecimal(parent, sum)) {
			findings.errors.push(issue("split_amount_mismatch", { line }));
		}
	}
}

/** Two `decimalSum` results, each `digits/scale`, equal as numbers. */
function sameDecimal(a: string, b: string): boolean {
	const [aDigits = "0", aScale = "0"] = a.split("/");
	const [bDigits = "0", bScale = "0"] = b.split("/");
	const scale = Math.max(Number(aScale), Number(bScale));

	return (
		BigInt(aDigits) * 10n ** BigInt(scale - Number(aScale)) ===
		BigInt(bDigits) * 10n ** BigInt(scale - Number(bScale))
	);
}

/** Sure's `validate_references`, `validate_tag_references` and `validate_split_line_references`. */
function checkReferences(parsed: Parsed, findings: Findings): void {
	const known = (namespace: Namespace, id: string) =>
		parsed.sourceIds.get(namespace)?.has(id) === true;
	const check = (
		record: Line,
		type: string,
		namespace: Namespace,
		field: string,
		value: unknown,
	) => {
		const id = idOf(value);

		if (id === null || known(namespace, id)) {
			return;
		}

		const params = { line: String(record.line), type, field, value: inspect(value) };

		if (SOFT_REFERENCE_TYPES.has(type)) {
			findings.warnings.push(issue("skipped_missing_reference", params));
		} else if (
			type === "RecurringTransaction" &&
			field === "merchant_id" &&
			isBlank(record.data.name)
		) {
			findings.warnings.push(issue("skipped_unnamed_recurring", params));
		} else if ((SOFT_REFERENCE_FIELDS[type] ?? []).includes(field)) {
			findings.warnings.push(issue("skipped_missing_merchant_reference", params));
		} else {
			findings.errors.push(issue("missing_reference", params));
		}
	};

	for (const [type, records] of parsed.records) {
		for (const record of records) {
			for (const [namespace, field] of REFERENCE_FIELDS[type] ?? []) {
				check(record, type, namespace, field, record.data[field]);
			}

			for (const tagId of arrayOf(record.data.tag_ids)) {
				check(record, type, "tags", "tag_ids", tagId);
			}

			const splitLines = type === "Transaction" ? splitLinesOf(record.data) : undefined;

			for (const split of Array.isArray(splitLines) ? splitLines : []) {
				if (isData(split)) {
					check(record, "Transaction split line", "categories", "category_id", split.category_id);
					check(record, "Transaction split line", "merchants", "merchant_id", split.merchant_id);

					for (const tagId of arrayOf(split.tag_ids)) {
						check(record, "Transaction split line", "tags", "tag_ids", tagId);
					}
				}
			}
		}
	}
}

/** Sure's `validate_duplicate_valuations`: one valuation per account and day. */
function checkValuations(parsed: Parsed, findings: Findings): void {
	const seen = new Map<string, number>();

	for (const record of recordsOf(parsed, "Valuation")) {
		const account = idOf(record.data.account_id);
		const date = idOf(record.data.date);

		if (account === null || date === null) {
			continue;
		}

		const key = JSON.stringify([account, date]);
		const first = seen.get(key);

		if (first === undefined) {
			seen.set(key, record.line);
		} else {
			findings.errors.push(
				issue("duplicate_valuation", {
					line: String(record.line),
					account: inspect(record.data.account_id),
					date,
					first: String(first),
				}),
			);
		}
	}
}

/** Sure's `dry_run_totals_from_line_type_counts`. */
function countsOf(parsed: Parsed): SureCounts {
	const count = (type: keyof typeof IMPORTABLE_TYPES) => parsed.counts.get(type) ?? 0;

	return {
		accounts: count("Account"),
		balances: count("Balance"),
		categories: count("Category"),
		tags: count("Tag"),
		merchants: count("Merchant"),
		recurring_transactions: count("RecurringTransaction"),
		transactions: count("Transaction"),
		transfers: count("Transfer"),
		rejected_transfers: count("RejectedTransfer"),
		trades: count("Trade"),
		holdings: count("Holding"),
		valuations: count("Valuation"),
		budgets: count("Budget"),
		budget_categories: count("BudgetCategory"),
		rules: count("Rule"),
	};
}

/**
 * Runs Sure's preflight on an uploaded archive: the file's own refusals
 * first, thrown, then each check in Sure's order, `between` reading the
 * lines Archant keeps after the required fields, as Sure's `validate_accountables`
 * comes there. Reads the household's category, tag and merchant names;
 * writes nothing.
 */
export async function runPreflight<Kept>(
	deps: ServiceDeps,
	file: { name: string; bytes: Uint8Array },
	limits: SureImportLimits,
	between: (parsed: Parsed, findings: Findings) => Kept,
): Promise<SurePreflight & { kept: Kept }> {
	const lines = checkFile(file, limits);
	const findings: Findings = { errors: [], warnings: [] };
	const parsed = parseRecords(lines, findings);

	checkTaxonomy(parsed, await existingNames(deps), findings);
	checkSourceIds(parsed, findings);
	checkRequiredFields(parsed, findings);
	const kept = between(parsed, findings);
	checkSplitLines(parsed, findings);
	checkReferences(parsed, findings);
	checkValuations(parsed, findings);

	return { counts: countsOf(parsed), ...findings, kept };
}
