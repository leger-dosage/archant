import type { IsoDate } from "../domain/dates.ts";
import type { ColumnKey, CsvImportType, ToolImportType } from "../schemas/csv-imports.ts";
import type { Clean } from "./csv-import-clean.ts";
import type { CsvRow, CsvTable, HeaderLookup } from "./csv-import-format.ts";
import type {
	AccountTypeMapping,
	Analysis,
	Configuration,
	CsvImportDeps,
	Edits,
	Mappings,
	PreviewMappings,
	ResolvedConfiguration,
	Sheet,
	ValueMapping,
} from "./csv-import-sheet.ts";
import type { ServiceDeps } from "./deps.ts";
import type { CsvTrade } from "./ledger/csv-trades.ts";
import type { Transaction } from "./ledger/shared.ts";
import type { ImportedAccount } from "./ledger/sure-import.ts";
import type { QifPreview, QifSheet } from "./qif-import.ts";
import type { PlanAccount } from "./sure-import-plan.ts";
import type { SureIssue } from "./sure-import-preflight.ts";

import { eq } from "drizzle-orm";

import type { AccountType } from "@archant/data/account-types";
import { isSubtypeOf, supportsTrades } from "@archant/data/account-types";
import { errorCode } from "@archant/data/backup";
import type { CategoryIcon } from "@archant/data/category-presets";
import {
	CATEGORY_COLOR_PATTERN,
	CATEGORY_ICONS,
	CATEGORY_NAME_MAX_LENGTH,
	newCategory,
	sampleCategoryColor,
} from "@archant/data/category-presets";
import { refreshStatistics } from "@archant/data/client";
import {
	formatQuantity,
	parseQuantity,
	parseTradePrice,
	scaledQuantity,
	scaledTradePrice,
} from "@archant/data/decimals";
import type { CurrencyCode, MinorUnits } from "@archant/data/money";
import { isCurrencyCode, parseDecimalAmount, toMinorUnits } from "@archant/data/money";
import { MERCHANT_NAME_MAX_LENGTH } from "@archant/data/name-limits";
import { accounts } from "@archant/data/schema/accounts";
import { categories } from "@archant/data/schema/categories";
import { merchants } from "@archant/data/schema/merchants";

import { decodeText } from "../connectors/decode.ts";
import { addDays, today } from "../domain/dates.ts";
import { buyCostFits, tradeAmount } from "../domain/trades.ts";
import { AppError } from "../lib/errors.ts";
import { ACCOUNT_NAME_MAX_LENGTH } from "../schemas/accounts.ts";
import {
	COLUMN_KEYS,
	CREATE_NEW_KEY,
	DEFAULT_DATE_FORMAT,
	MAX_CSV_BYTES,
	dateFormatsOf,
	cleanColumnsOf,
	isToolImport,
	maxRowsOf,
} from "../schemas/csv-imports.ts";
import { MERCHANT_WEBSITE_MAX_LENGTH } from "../schemas/merchants.ts";
import { cleanOf } from "./csv-import-clean.ts";
import {
	columnOf,
	csvIssue,
	csvValue,
	detectDateFormat,
	headerLookup,
	parseCsv,
	strptime,
	yearsFrom,
} from "./csv-import-format.ts";
import { analyseRules } from "./csv-import-rules.ts";
import {
	ALIASES,
	cellOf,
	currencyOf,
	dateOf,
	editOf,
	editsOf,
	headerCellOf,
	keysOf,
	lineOf,
	nothingToWrite,
	numberOf,
	valueMappings,
} from "./csv-import-sheet.ts";
import { TOOL_PRESETS } from "./csv-import-tools.ts";
import { analyseTransactions } from "./csv-import-transactions.ts";
import { createAccount } from "./ledger/accounts.ts";
import { insertCsvTrades, listingOf, storedListing } from "./ledger/csv-trades.ts";
import { oneByOne } from "./ledger/shared.ts";
import { analyseQif, readQifSheet } from "./qif-import.ts";
import { getReportingCurrency } from "./settings.ts";
import { cut } from "./sure-import-plan.ts";
import { foldName, tooLarge } from "./sure-import-preflight.ts";

// Sure's raw-data CSV imports at 00dd977fb, stateless: the page keeps the
// file and its choices and posts them to the preview, which reads them and
// says what the import would write, and to the import, which reads them
// again and writes everything in one immediate transaction, or nothing.

export type CsvImportRequest = {
	type: CsvImportType;
	file: { name: string; bytes: Uint8Array };
	configuration?: Configuration | undefined;
	/** « Nettoyer »'s cell edits, read before the file's cells. */
	edits?: Edits | undefined;
	mappings?: Mappings | undefined;
};

export type CsvImportPreview = {
	headers: string[];
	/** Sure's `csv_sample`: the first two data rows, one cell per header. */
	sample: string[][];
	configuration: ResolvedConfiguration;
	/**
	 * « Première date analysée »: the first date of the file read with the
	 * chosen format, and whether any offered format reads one; `null`
	 * without a date column.
	 */
	dates: { detected: boolean; first: IsoDate | null } | null;
	mappings: PreviewMappings;
	/** « Configurer et sélectionner » of a QIF file; `null` for a CSV. */
	qif: QifPreview | null;
	/**
	 * The type column's distinct values, in file order, among which « Définir
	 * … comme valeur d'identifiant » picks, Sure's `selectable_amount_type_values`.
	 */
	typeValues: string[];
	/** « Nettoyer »: Sure's rows, their values through the edits, each refusal on its cell. */
	clean: Clean;
	/** Sure's `dry_run`, by `dry_run_resources` key. */
	counts: Record<string, number>;
	/** Every refusal, its line among its params; any one leaves nothing to publish. */
	errors: SureIssue[];
};

/** Sure's `AccountTypeMapping` keys preselected: its accountable classes, then Archant's own types. */
const ACCOUNTABLE_TYPES: Record<string, AccountType> = {
	Depository: "depository",
	Investment: "investment",
	Crypto: "crypto",
	Property: "property",
	Vehicle: "vehicle",
	OtherAsset: "other_asset",
	CreditCard: "credit_card",
	Loan: "loan",
	OtherLiability: "other_liability",
	depository: "depository",
	investment: "investment",
	crypto: "crypto",
	property: "property",
	vehicle: "vehicle",
	other_asset: "other_asset",
	credit_card: "credit_card",
	loan: "loan",
	other_liability: "other_liability",
};

/** Sure's `rows_to_skip`, which only the transaction import's form offers. */
const rowsToSkipOf = (type: CsvImportType, given: Configuration | undefined) =>
	type === "transactions" ? (given?.rowsToSkip ?? 0) : 0;

/** What a request reads: a CSV file's table, or a QIF file's rows read whole. */
type Source = { kind: "csv"; table: CsvTable } | { kind: "qif"; qif: QifSheet };

/**
 * The file as text and rows, or refused: larger than Sure's `MAX_CSV_SIZE`
 * before it is read, no headers or data row with the chosen separator
 * (`CSV_INVALID`), more rows than Sure's `max_row_count`. A QIF file is read
 * by Sure's `QifParser` into its rows instead.
 */
function readSource(request: CsvImportRequest, day: IsoDate): Source {
	const max = maxRowsOf(request.type);

	if (request.file.bytes.length > MAX_CSV_BYTES) {
		throw tooLarge({ maxBytes: MAX_CSV_BYTES, maxRows: max });
	}

	const text = decodeText(request.file.bytes);

	if (request.type === "qif") {
		return {
			kind: "qif",
			qif: readQifSheet(
				{
					text,
					fileName: request.file.name,
					configuration: request.configuration,
					edits: request.edits,
					maxRows: max,
				},
				day,
				getReportingCurrency(),
			),
		};
	}

	const table = parseCsv(
		text,
		request.configuration?.separator ?? ",",
		rowsToSkipOf(request.type, request.configuration),
	);

	if (table === null) {
		throw new AppError(
			"CSV_INVALID",
			"The file must be valid CSV with headers and at least one row of data.",
		);
	}

	if (table.rows.length > max) {
		throw new AppError("IMPORT_TOO_MANY_ROWS", `The file has more than ${max} rows.`, undefined, {
			max: String(max),
		});
	}

	return { kind: "csv", table };
}

/** The header a key preselects: the first whose name is the key or one of its aliases. */
function preselected(table: CsvTable, lookup: HeaderLookup, key: ColumnKey): string | null {
	for (const alias of ALIASES[key]) {
		const column = columnOf(lookup, alias);

		if (column !== undefined) {
			return table.headers[column] ?? null;
		}
	}

	return null;
}

/**
 * The keys « Configurer » maps for `type`: a single-account trade or
 * transaction import has no account column.
 */
function columnKeysOf(type: CsvImportType, accountId: string | null): readonly ColumnKey[] {
	if (type === "accounts" || isToolImport(type)) {
		return COLUMN_KEYS[type];
	}

	if (type === "trades" || type === "transactions") {
		return COLUMN_KEYS[type].filter((key) => key !== "account" || accountId === null);
	}

	return [];
}

/** The header a tool's `DEFAULT_COLUMN_MAPPINGS` names for a key, when the file has it. */
function presetColumn(table: CsvTable, lookup: HeaderLookup, type: ToolImportType, key: ColumnKey) {
	const label = TOOL_PRESETS[type].columns[key];
	const column = label === undefined ? undefined : columnOf(lookup, label);

	return column === undefined ? null : (table.headers[column] ?? null);
}

/**
 * The page's choices, each absent one taking Sure's default or the file's
 * suggestion: a column whose header is the key or an alias, the date format
 * `detect_date_format` finds among the offered ones. A transaction import's
 * columns start empty, as Sure's form; a tool's take its
 * `DEFAULT_COLUMN_MAPPINGS`, its date format included, and name no account
 * at upload. A column the file does not have reads as none.
 */
function resolveConfiguration(
	type: CsvImportType,
	given: Configuration | undefined,
	table: CsvTable,
	lookup: HeaderLookup,
	day: IsoDate,
): ResolvedConfiguration {
	const accountId =
		type === "trades" || type === "transactions" ? (given?.accountId ?? null) : null;
	const tool = isToolImport(type) ? type : null;
	const columns: Partial<Record<ColumnKey, string | null>> = {};

	for (const key of columnKeysOf(type, accountId)) {
		const chosen = given?.columns?.[key];

		columns[key] =
			chosen === undefined
				? tool !== null
					? presetColumn(table, lookup, tool, key)
					: type === "transactions"
						? null
						: preselected(table, lookup, key)
				: chosen !== null && table.headers.includes(chosen)
					? chosen
					: null;
	}

	const offered = dateFormatsOf(type).map(([, format]) => format);
	const samples = table.rows.map(
		(row) => csvValue(lookup, row.cells, columns.date, ...ALIASES.date) ?? "",
	);

	return {
		separator: given?.separator ?? ",",
		numberFormat: given?.numberFormat ?? "1,234.56",
		dateFormat:
			given?.dateFormat !== undefined && offered.includes(given.dateFormat)
				? given.dateFormat
				: tool !== null
					? TOOL_PRESETS[tool].dateFormat
					: columns.date === undefined
						? DEFAULT_DATE_FORMAT
						: detectDateFormat(samples, offered, day),
		// YNAB's form has no convention: its inflows are positive, Sure's preset.
		signage: tool === "ynab" ? "inflows_positive" : (given?.signage ?? "inflows_positive"),
		rowsToSkip: rowsToSkipOf(type, given),
		amountTypeStrategy:
			tool === null ? (given?.amountTypeStrategy ?? "signed_amount") : "signed_amount",
		amountTypeIdentifier: tool === null ? (given?.amountTypeIdentifier ?? null) : null,
		amountTypeInflow: tool === null ? (given?.amountTypeInflow ?? null) : null,
		accountId,
		columns,
	};
}

// --- Accounts ---------------------------------------------------------------

/** Each type value mapped as the page chose, else preselected when it names a type. */
function accountTypeMappings(
	keys: readonly { key: string; count: number }[],
	given: Mappings["accountTypes"],
): AccountTypeMapping[] {
	const chosen = new Map((given ?? []).map((mapping) => [mapping.key, mapping]));

	return keys.map(({ key, count }) => {
		const mapping = chosen.get(key);

		if (mapping !== undefined) {
			return { key, count, type: mapping.type, subtype: mapping.subtype };
		}

		const type = Object.hasOwn(ACCOUNTABLE_TYPES, key) ? ACCOUNTABLE_TYPES[key] : undefined;

		return { key, count, type: type ?? null, subtype: null };
	});
}

/**
 * Sure's `AccountImport`: each row an account, its balance the opening
 * anchor on the row's date, else two years before today, as
 * `OpeningBalanceManager#default_date`; its type from « Attribuez vos types
 * de comptes », a loan's or a property's subtype included, which Archant
 * requires.
 */
function analyseAccounts(sheet: Sheet, mappings: Mappings | undefined): Analysis {
	const errors: SureIssue[] = [];
	const read: {
		key: string;
		name: string;
		amount: MinorUnits;
		currency: CurrencyCode;
		date: IsoDate;
	}[] = [];
	const keys = keysOf(sheet.table.rows.map((row) => cellOf(sheet, row, "entity_type") ?? ""));
	const types = accountTypeMappings(keys, mappings?.accountTypes);

	for (const row of sheet.table.rows) {
		const before = errors.length;
		const name = cellOf(sheet, row, "name")?.trim() ?? "";
		const currency = currencyOf(sheet, row, sheet.currency, errors);
		const decimal = numberOf(sheet, row, "amount", errors);
		const dateText = cellOf(sheet, row, "date") ?? "";
		const date =
			dateText === "" ? yearsFrom(sheet.today, -2) : dateOf(sheet, row, dateText, errors);

		if (name === "") {
			errors.push(csvIssue("required", { line: lineOf(row), field: "name" }));
		}

		const amount =
			decimal === null || currency === null ? null : parseDecimalAmount(decimal, currency);

		if (decimal !== null && currency !== null && amount === null) {
			errors.push(csvIssue("invalid_number", { line: lineOf(row), field: "amount" }));
		}

		if (errors.length === before && amount !== null && currency !== null && date !== null) {
			read.push({
				key: cellOf(sheet, row, "entity_type") ?? "",
				name: cut(name, ACCOUNT_NAME_MAX_LENGTH),
				amount,
				currency,
				date,
			});
		}
	}

	for (const mapping of types) {
		if (mapping.type === null || !isSubtypeOf(mapping.type, mapping.subtype)) {
			errors.push(csvIssue("unmapped_account_type", { key: mapping.key }));
		}
	}

	return {
		counts: { accounts: sheet.table.rows.length },
		errors,
		mappings: { accountTypes: types },
		write: async (tx, deps) => {
			const byKey = new Map(types.map((mapping) => [mapping.key, mapping]));

			await oneByOne(read, async (account) => {
				const mapping = byKey.get(account.key);

				if (mapping?.type === null || mapping === undefined) {
					return;
				}

				await createAccount(
					{ ...deps, db: tx },
					{
						name: account.name,
						type: mapping.type,
						subtype: mapping.subtype,
						currency: account.currency,
						openingBalance: account.amount,
						openingDate: account.date,
					},
					{ origin: "user" },
				);
			});
		},
	};
}

// --- Categories -------------------------------------------------------------

type CategoryState = {
	id: string;
	name: string;
	color: string;
	icon: CategoryIcon;
	parentId: string | null;
	stored: boolean;
};

/** Sure's `missing_columns`: the required headers the file lacks. */
function missingColumns(lookup: HeaderLookup, required: readonly string[]): SureIssue | null {
	const missing = required.filter((header) => columnOf(lookup, header) === undefined);

	return missing.length === 0 ? null : csvIssue("missing_columns", { columns: missing.join(", ") });
}

const categoryName = (name: string) => cut(name.trim().normalize("NFC"), CATEGORY_NAME_MAX_LENGTH);

/**
 * Sure's `CategoryImport`: each row finds its category by name, folded as
 * Archant compares names, else creates it; takes the file's
 * colour and icon when Archant reads them, and the file's parent, found or
 * created as a placeholder, none when blank. A child takes its parent's
 * colour. A category its own parent, or a tree deeper than two levels,
 * is refused on its line.
 */
async function analyseCategories(db: Pick<Transaction, "select">, sheet: Sheet): Promise<Analysis> {
	const counts = { categories: sheet.table.rows.length };
	const missing = missingColumns(sheet.lookup, ["name"]);

	if (missing !== null) {
		return { counts, errors: [missing], write: nothingToWrite };
	}

	const errors: SureIssue[] = [];
	const stored = await db.select().from(categories);
	const all = new Map<string, CategoryState>(
		stored.map((row) => [row.id, { ...row, icon: row.icon, stored: true }]),
	);
	const byName = new Map([...all.values()].map((row) => [foldName(row.name), row]));
	const original = new Map(stored.map((row) => [row.id, { ...row }]));

	/** Sure's `ensure_placeholder_category`: a parent found by name, else created plain. */
	const ensure = (name: string): CategoryState => {
		const found = byName.get(foldName(name));

		if (found !== undefined) {
			return found;
		}

		const preset = newCategory(name);
		const created: CategoryState = {
			id: crypto.randomUUID(),
			name,
			color: preset.color,
			icon: preset.icon,
			parentId: null,
			stored: false,
		};

		all.set(created.id, created);
		byName.set(foldName(name), created);

		return created;
	};

	const rows = sheet.table.rows.flatMap((row) => {
		const name = categoryName(headerCellOf(sheet, row, "name"));

		if (name === "") {
			errors.push(csvIssue("required", { line: lineOf(row), field: "name" }));

			return [];
		}

		const category = ensure(name);
		const color = headerCellOf(sheet, row, "category_color").toLowerCase();
		const icon = CATEGORY_ICONS.find(
			(known) => known === headerCellOf(sheet, row, "category_icon"),
		);
		const parent = categoryName(headerCellOf(sheet, row, "category_parent"));

		if (CATEGORY_COLOR_PATTERN.test(color)) {
			category.color = color;
		}

		if (icon !== undefined) {
			category.icon = icon;
		}

		category.parentId = null;

		return [{ row, category, parent: parent === "" ? null : ensure(parent) }];
	});

	for (const { row, category, parent } of rows) {
		if (parent === category) {
			errors.push(csvIssue("own_parent", { line: lineOf(row), name: category.name }));
		} else {
			category.parentId = parent?.id ?? null;
		}
	}

	const hasChildren = (id: string) => [...all.values()].some((other) => other.parentId === id);

	for (const { row, category, parent } of rows) {
		if (
			parent !== null &&
			parent !== category &&
			(parent.parentId !== null || hasChildren(category.id))
		) {
			errors.push(csvIssue("nested_category", { line: lineOf(row), name: category.name }));
		}
	}

	// A child carries its parent's colour, as `updateCategory` keeps it.
	for (const category of all.values()) {
		const parent = category.parentId === null ? undefined : all.get(category.parentId);

		if (parent !== undefined) {
			category.color = parent.color;
		}
	}

	return {
		counts,
		errors,
		write: async (tx) => {
			const now = Date.now();
			const created = [...all.values()].filter((category) => !category.stored);

			await oneByOne(created, async (category) =>
				tx.insert(categories).values({
					id: category.id,
					name: category.name,
					color: category.color,
					icon: category.icon,
					parentId: null,
					createdAt: now,
					updatedAt: now,
				}),
			);

			await oneByOne([...all.values()], async (category) => {
				const before = original.get(category.id);
				const changed =
					before === undefined
						? category.parentId !== null
						: before.color !== category.color ||
							before.icon !== category.icon ||
							before.parentId !== category.parentId;

				if (changed) {
					await tx
						.update(categories)
						.set({
							color: category.color,
							icon: category.icon,
							parentId: category.parentId,
							updatedAt: now,
						})
						.where(eq(categories.id, category.id));
				}
			});
		},
	};
}

// --- Merchants --------------------------------------------------------------

/**
 * Sure's `MerchantImport`: a blank name is skipped, a name the household
 * holds, folded, is kept, any other created with the file's colour, one
 * of Sure's ten when it has none that reads, and its website.
 */
async function analyseMerchants(db: Pick<Transaction, "select">, sheet: Sheet): Promise<Analysis> {
	const counts = { merchants: sheet.table.rows.length };
	const missing = missingColumns(sheet.lookup, ["name"]);

	if (missing !== null) {
		return { counts, errors: [missing], write: nothingToWrite };
	}

	const known = new Set(
		(await db.select({ name: merchants.name }).from(merchants)).map((row) => foldName(row.name)),
	);
	const created: { name: string; color: string | null; websiteUrl: string | null }[] = [];

	for (const row of sheet.table.rows) {
		const name = cut(headerCellOf(sheet, row, "name").normalize("NFC"), MERCHANT_NAME_MAX_LENGTH);

		if (name !== "" && !known.has(foldName(name))) {
			const color = headerCellOf(sheet, row, "merchant_color").toLowerCase();
			const website = headerCellOf(sheet, row, "merchant_website");

			known.add(foldName(name));
			created.push({
				name,
				color: CATEGORY_COLOR_PATTERN.test(color) ? color : null,
				websiteUrl: website === "" ? null : cut(website, MERCHANT_WEBSITE_MAX_LENGTH),
			});
		}
	}

	return {
		counts,
		errors: [],
		write: async (tx) => {
			const now = Date.now();

			await oneByOne(created, async ({ name, color, websiteUrl }) =>
				tx.insert(merchants).values({
					id: crypto.randomUUID(),
					name,
					color: color ?? sampleCategoryColor(),
					websiteUrl,
					createdAt: now,
					updatedAt: now,
				}),
			);
		},
	};
}

// --- Trades -----------------------------------------------------------------

/** The accounts a trade may go to, as Sure's `supports_trades?`, active ones only. */
async function tradingAccounts(db: Pick<Transaction, "select">) {
	const rows = await db
		.select({
			id: accounts.id,
			name: accounts.name,
			type: accounts.type,
			subtype: accounts.subtype,
			currency: accounts.currency,
			active: accounts.active,
		})
		.from(accounts);

	return rows.filter((account) => account.active && supportsTrades(account));
}

/**
 * Each account name of a trade file mapped as Sure's `sync_mappings`: the
 * trading account of that exact name, else a new one for a name.
 */
const accountMappings = (
	keys: readonly { key: string; count: number }[],
	given: Mappings["accounts"],
	trading: readonly { id: string; name: string }[],
): ValueMapping[] =>
	valueMappings(
		keys,
		given,
		new Set(trading.map((account) => account.id)),
		(key) => trading.find((account) => account.name === key)?.id,
	);

/** A quantity or a price that reads, `null` with an issue when it does not. */
function decimalOf<Value>(
	sheet: Sheet,
	row: CsvRow,
	key: "qty" | "price",
	parse: (text: string) => Value | null,
	errors: SureIssue[],
): Value | null {
	const decimal = numberOf(sheet, row, key, errors);
	const value = decimal === null ? null : parse(decimal);

	if (decimal !== null && value === null) {
		errors.push(csvIssue("invalid_number", { line: lineOf(row), field: key }));
	}

	return value;
}

/**
 * Sure's `TradeImport`: each row a buy or a sale of `quantity × price`, fee
 * zero, on the chosen account or the one « Attribuez vos comptes » maps its
 * name to. « Les achats sont en quantité négative » negates the quantity and
 * so the amount (AD-5, AD-22). A row in another currency than its account,
 * a quantity of zero, a negative price, an amount no balance holds or a
 * security stored in another currency is refused on its line.
 */
async function analyseTrades(
	db: Pick<Transaction, "select">,
	sheet: Sheet,
	mappings: Mappings | undefined,
): Promise<Analysis> {
	const errors: SureIssue[] = [];
	const trading = await tradingAccounts(db);
	const single = sheet.configuration.accountId;

	if (single !== null && !trading.some((account) => account.id === single)) {
		throw new AppError("TRADES_NOT_SUPPORTED", "Account does not support trades");
	}

	const keyOf = (row: CsvRow) => cellOf(sheet, row, "account") ?? "";
	const accountsMapped =
		single === null
			? accountMappings(keysOf(sheet.table.rows.map(keyOf)), mappings?.accounts, trading)
			: [];
	const mapped = new Map(accountsMapped.map((mapping) => [mapping.key, mapping.value]));
	const byId = new Map(trading.map((account) => [account.id, account]));
	// The currency each listing takes, by ticker and MIC, and by ticker alone
	// for a row without MIC, which reuses the first listing of its ticker.
	const securityCurrencies = new Map<string, string>();
	const tickerCurrencies = new Map<string, string>();
	const read: CsvTrade[] = [];
	const firstTrades = new Map<string, IsoDate>();
	let skipped = 0;

	await oneByOne(sheet.table.rows, async (row) => {
		const before = errors.length;
		const dateText = cellOf(sheet, row, "date") ?? "";

		if (dateText === "") {
			errors.push(csvIssue("required", { line: lineOf(row), field: "date" }));
		}

		const date = dateText === "" ? null : dateOf(sheet, row, dateText, errors);
		const ticker = cellOf(sheet, row, "ticker")?.trim().toUpperCase() ?? "";
		const mic = cellOf(sheet, row, "exchange_operating_mic")?.trim().toUpperCase() || null;
		const quantity = decimalOf(sheet, row, "qty", parseQuantity, errors);
		const price = decimalOf(sheet, row, "price", parseTradePrice, errors);

		if (ticker === "") {
			errors.push(csvIssue("required", { line: lineOf(row), field: "ticker" }));
		}

		// The export's `trades.csv` writes a dividend or interest at quantity
		// zero; Sure imports it as a trade of amount zero, which moves no cash.
		if (quantity !== null && scaledQuantity(quantity) === 0n) {
			skipped += 1;

			return;
		}

		if (price !== null && scaledTradePrice(price) < 0n) {
			errors.push(csvIssue("negative_price", { line: lineOf(row) }));
		}

		const value = single ?? mapped.get(keyOf(row)) ?? null;
		const account = value === null ? undefined : byId.get(value);
		const accountCurrency: CurrencyCode | null =
			account !== undefined && isCurrencyCode(account.currency)
				? account.currency
				: value === CREATE_NEW_KEY
					? sheet.currency
					: null;
		const currency = currencyOf(sheet, row, accountCurrency, errors);

		if (currency !== null && accountCurrency !== null && currency !== accountCurrency) {
			errors.push(
				csvIssue("CURRENCY_MISMATCH", { line: lineOf(row), currency, account: accountCurrency }),
			);
		}

		if (
			errors.length > before ||
			date === null ||
			quantity === null ||
			price === null ||
			value === null ||
			accountCurrency === null
		) {
			return;
		}

		const signed =
			sheet.configuration.signage === "inflows_negative"
				? formatQuantity(-scaledQuantity(quantity))
				: quantity;
		const trade = { quantity: signed, price, fee: toMinorUnits(0) };
		const amount = tradeAmount(trade, accountCurrency);

		if (amount === null || !buyCostFits(trade, accountCurrency)) {
			errors.push(csvIssue("trade_too_large", { line: lineOf(row) }));

			return;
		}

		const security = listingOf(ticker, mic);
		// As the write's resolver: a MIC row's own listing first; a row without
		// MIC, the stored listing of its ticker first, else one the file made.
		const held =
			mic === null
				? ((await storedListing(db, security))?.currency ?? tickerCurrencies.get(ticker))
				: (securityCurrencies.get(security.key) ?? (await storedListing(db, security))?.currency);

		if (held !== undefined && held !== accountCurrency) {
			errors.push(csvIssue("security_currency", { line: lineOf(row), ticker }));

			return;
		}

		if (!securityCurrencies.has(security.key)) {
			securityCurrencies.set(security.key, accountCurrency);
		}

		if (!tickerCurrencies.has(ticker)) {
			tickerCurrencies.set(ticker, accountCurrency);
		}

		const accountKey = value === CREATE_NEW_KEY ? `new ${keyOf(row)}` : value;
		const first = firstTrades.get(accountKey);

		firstTrades.set(accountKey, first === undefined || date < first ? date : first);
		read.push({ accountKey, date, ticker, mic, quantity: signed, price, amount });
	});

	for (const mapping of accountsMapped) {
		if (mapping.value === null) {
			errors.push(csvIssue("unmapped_account", { key: mapping.key }));
		}
	}

	// Only a name with a trade to hold gets an account: one whose every line
	// was skipped at quantity zero would be empty.
	const created = accountsMapped.filter(
		(mapping) => mapping.value === CREATE_NEW_KEY && firstTrades.has(`new ${mapping.key}`),
	);

	return {
		counts: {
			trades: sheet.table.rows.length - skipped,
			...(single === null ? { accounts: created.length } : {}),
		},
		errors,
		mappings: { accounts: accountsMapped },
		write: async (tx, deps) => {
			const newAccounts = created.flatMap((mapping): PlanAccount[] => {
				const sourceId = `new ${mapping.key}`;
				const first = firstTrades.get(sourceId);

				return first === undefined
					? []
					: [
							{
								sourceId,
								name: cut(mapping.key.trim(), ACCOUNT_NAME_MAX_LENGTH),
								type: "investment",
								subtype: null,
								currency: sheet.currency,
								active: true,
								excludedFromReports: false,
								institutionName: null,
								institutionDomain: null,
								notes: null,
								details: null,
								opening: { date: addDays(first, -1), amount: toMinorUnits(0) },
							},
						];
			});
			const existing = new Map<string, ImportedAccount>(
				trading.map((account) => [
					account.id,
					{ id: account.id, type: account.type, currency: account.currency },
				]),
			);

			await insertCsvTrades(
				tx,
				{ existing, newAccounts, trades: read },
				{ now: Date.now(), timeZone: deps.timeZone },
			);
		},
	};
}

// --- Entry points -----------------------------------------------------------

/** The first two rows, one cell per header, as Sure's `csv_sample`. */
const sampleOf = (table: CsvTable) =>
	table.rows.slice(0, 2).map((row) => table.headers.map((_, column) => row.cells[column] ?? ""));

/** The chosen type column's values, as Sure's `selectable_amount_type_values`. */
function typeValuesOf(sheet: Sheet): string[] {
	const header = sheet.configuration.columns.entity_type ?? null;
	const column =
		sheet.type === "transactions" && header !== null ? sheet.table.headers.indexOf(header) : -1;

	return column === -1 ? [] : [...new Set(sheet.table.rows.map((row) => row.cells[column] ?? ""))];
}

/** « Première date analysée », or « Impossible de détecter le format de date ». */
function datesOf(sheet: Sheet): CsvImportPreview["dates"] {
	if (sheet.configuration.columns.date === undefined || sheet.configuration.columns.date === null) {
		return null;
	}

	const samples = sheet.table.rows
		.map((row) => cellOf(sheet, row, "date") ?? "")
		.filter((sample) => sample !== "");
	const [first] = samples;

	if (first === undefined) {
		return null;
	}

	return {
		detected: dateFormatsOf(sheet.type).some(([, format]) =>
			samples.some((sample) => strptime(sample, format) !== null),
		),
		first: strptime(first, sheet.configuration.dateFormat),
	};
}

async function analyse(
	db: Pick<Transaction, "select">,
	request: CsvImportRequest,
	source: Source,
	day: IsoDate,
): Promise<{ sheet: Sheet; analysis: Analysis }> {
	if (source.kind === "qif") {
		return {
			sheet: source.qif.sheet,
			analysis: await analyseQif(db, source.qif, request.mappings),
		};
	}

	const { table } = source;
	const lookup = headerLookup(table.headers);
	const configuration = resolveConfiguration(
		request.type,
		request.configuration,
		table,
		lookup,
		day,
	);
	const sheet: Sheet = {
		type: request.type,
		fileName: request.file.name,
		table,
		lookup,
		configuration,
		today: day,
		currency: getReportingCurrency(),
		edits: editsOf(request.edits, cleanColumnsOf(request.type, configuration.accountId)),
	};

	if (lookup.duplicates.length > 0) {
		return {
			sheet,
			analysis: {
				counts: {},
				errors: [
					csvIssue("duplicate_headers", {
						columns: lookup.duplicates.map((group) => group.join(", ")).join("; "),
					}),
				],
				write: nothingToWrite,
			},
		};
	}

	return { sheet, analysis: await analysisOf(db, request, sheet) };
}

/** What the import of `request.type` reads from the sheet. */
async function analysisOf(
	db: Pick<Transaction, "select">,
	request: CsvImportRequest,
	sheet: Sheet,
): Promise<Analysis> {
	switch (request.type) {
		case "accounts":
			return analyseAccounts(sheet, request.mappings);
		case "categories":
			return analyseCategories(db, sheet);
		case "merchants":
			return analyseMerchants(db, sheet);
		case "transactions":
		case "mint":
		case "ynab":
		case "actual":
			return analyseTransactions(db, sheet, request.mappings);
		case "rules":
			return analyseRules(db, {
				rows: sheet.table.rows,
				lookup: sheet.lookup,
				separator: sheet.configuration.separator,
				edited: (row, key) => editOf(sheet, row, key),
			});
		default:
			return analyseTrades(db, sheet, request.mappings);
	}
}

/**
 * The preview « Configurer », « Nettoyer », « Mapper » and « Confirmer »
 * read: the headers and sample, the choices made or suggested, the rows
 * through their edits, the values to map, Sure's `dry_run` counts and every
 * refusal. Writes nothing.
 */
export async function previewCsvImport(
	deps: ServiceDeps,
	request: CsvImportRequest,
): Promise<CsvImportPreview> {
	const day = today(deps.timeZone);
	const source = readSource(request, day);
	const { sheet, analysis } = await analyse(deps.db, request, source, day);
	const qif = source.kind === "qif" ? source.qif : null;

	return {
		headers: sheet.table.headers,
		sample: qif === null ? sampleOf(sheet.table) : [],
		configuration: qif?.configuration ?? sheet.configuration,
		dates: qif === null ? datesOf(sheet) : null,
		typeValues: typeValuesOf(sheet),
		qif: qif?.preview ?? null,
		mappings: {
			accountTypes: analysis.mappings?.accountTypes ?? [],
			accounts: analysis.mappings?.accounts ?? [],
			categories: analysis.mappings?.categories ?? [],
			tags: analysis.mappings?.tags ?? [],
		},
		clean: cleanOf(sheet, analysis.errors),
		counts: analysis.counts,
		errors: analysis.errors,
	};
}

/**
 * « Publier l'importation »: reads the file again inside one immediate
 * transaction, refuses it with `CSV_IMPORT_INVALID` while the preview finds
 * an error or a value left to map, then writes it all, or nothing. Trades
 * refresh the statistics once committed. One log line says how it ended, its
 * type, counts and a code only (AD-14).
 */
export async function importCsv(
	deps: CsvImportDeps,
	request: CsvImportRequest,
): Promise<{ counts: Record<string, number> }> {
	const started = performance.now();

	try {
		// Parsed before the write lock is taken: the table depends on no row.
		const day = today(deps.timeZone);
		const source = readSource(request, day);
		const { counts, committed } = await deps.db.transaction(
			async (tx) => {
				const { analysis } = await analyse(tx, request, source, day);

				if (analysis.errors.length > 0) {
					throw new AppError("CSV_IMPORT_INVALID", "The file's preview found errors.");
				}

				await analysis.write(tx, deps);

				return analysis;
			},
			{ behavior: "immediate" },
		);
		const durationMs = Math.round(performance.now() - started);

		await committed?.(deps);

		if (request.type === "trades" || (request.type === "qif" && (counts["trades"] ?? 0) > 0)) {
			try {
				await refreshStatistics(deps.db);
			} catch (error) {
				deps.logger.warn({ code: errorCode(error) }, "statistics refresh failed");
			}
		}

		deps.logger.info({ type: request.type, ...counts, durationMs }, "csv import finished");

		return { counts };
	} catch (error) {
		const durationMs = Math.round(performance.now() - started);

		// The code only: an unexpected error's message may embed bound values.
		if (error instanceof AppError) {
			deps.logger.info({ type: request.type, code: error.code, durationMs }, "csv import refused");
		} else {
			deps.logger.error(
				{ type: request.type, code: "INTERNAL_ERROR", durationMs },
				"csv import failed",
			);
		}

		throw error;
	}
}
