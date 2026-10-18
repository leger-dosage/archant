import type { IsoDate } from "../domain/dates.ts";
import type { ImportedSplitLine, NormalizedTransaction } from "../domain/statement.ts";
import type { CsvRow, CsvTable } from "./csv-import-format.ts";
import type {
	Analysis,
	Configuration,
	Edits,
	Mappings,
	ResolvedConfiguration,
	Sheet,
} from "./csv-import-sheet.ts";
import type { CsvTrade } from "./ledger/csv-trades.ts";
import type { CsvStatement } from "./ledger/csv-transactions.ts";
import type { Transaction } from "./ledger/shared.ts";
import type { ImportedAccount } from "./ledger/sure-import.ts";
import type { QifFile, QifSplit } from "./qif-reader.ts";
import type { SureIssue } from "./sure-import-preflight.ts";

import type { AccountType } from "@archant/data/account-types";
import { supportsTrades } from "@archant/data/account-types";
import { parseQuantity, parseTradePrice, scaledQuantity } from "@archant/data/decimals";
import type { CurrencyCode, MinorUnits } from "@archant/data/money";
import { isCurrencyCode, parseDecimalAmount, toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";

import { decimalAmountOf } from "../connectors/qif/qif.ts";
import { toStoredBalance } from "../domain/balances/stored-balance.ts";
import { addDays } from "../domain/dates.ts";
import { buyCostFits, conversionFee, tradeAmount, unsignedQuantity } from "../domain/trades.ts";
import { AppError } from "../lib/errors.ts";
import { ACCOUNT_NAME_MAX_LENGTH } from "../schemas/accounts.ts";
import { CREATE_NEW_KEY, DATE_FORMATS, cleanColumnsOf } from "../schemas/csv-imports.ts";
import { LABEL_MAX_LENGTH, MAX_SPLIT_LINES, NOTES_MAX_LENGTH } from "../schemas/transactions.ts";
import {
	csvIssue,
	detectDateFormat,
	headerLookup,
	splitTags,
	yearsFrom,
} from "./csv-import-format.ts";
import {
	cellOf,
	currencyOf,
	dateOf,
	editsOf,
	keysOf,
	lineOf,
	numberOf,
	valueMappings,
} from "./csv-import-sheet.ts";
import { categoryOf } from "./csv-import-tools.ts";
import { classificationsOf, idsOf, readRows } from "./csv-import-transactions.ts";
import { STATISTICS_REFRESH_LINES, detectAfterImport, refreshAfterImport } from "./imports.ts";
import { createAccount } from "./ledger/accounts.ts";
import { insertCsvTrades, listingOf, storedListing } from "./ledger/csv-trades.ts";
import { ingestCsvStatements } from "./ledger/csv-transactions.ts";
import { oneByOne } from "./ledger/shared.ts";
import {
	BUY_ACTIONS,
	INFLOW_ACTIONS,
	SELL_ACTIONS,
	qifDateOf,
	qifDecimalOf,
	readQif,
} from "./qif-reader.ts";
import { cut } from "./sure-import-plan.ts";
import { foldName } from "./sure-import-preflight.ts";

// Sure's `QifImport` at 00dd977fb: a Quicken file's records made into
// Sure's rows (`generate_transaction_rows`, `generate_investment_rows`),
// which « Nettoyer », « Mapper » and « Confirmer » read as any import's
// rows, then published as `import_transaction_rows!` and
// `import_investment_rows!` do: lines through the pipeline (AD-4), split
// records as split lines (AD-20), buys and sales as trades (AD-22).

/** Sure's fallback when no format reads the file's dates, `detect_and_set_qif_date_format!`'s. */
const QIF_DEFAULT_DATE_FORMAT = "%m/%d/%Y";

/** Sure's `%Y-%m-%d`: a row's date once its `D` field is read. */
const ROW_DATE_FORMAT = "%Y-%m-%d";

/** A row's fields, Sure's `Import::Row` columns a QIF import fills. */
const HEADERS = [
	"date",
	"amount",
	"name",
	"currency",
	"category",
	"tags",
	"account",
	"notes",
	"ticker",
	"qty",
	"price",
] as const;

type Header = (typeof HEADERS)[number];

/** What a row is beyond its cells: a line, an investment account's cash line, or a trade. */
type RowKind = "transaction" | "cash" | "trade";

type RowFacts = {
	kind: RowKind;
	/** The QIF type of the row's account, which a new account takes. */
	accountType: string;
	/** A line's split groups, each with the category and tags the selection keeps. */
	splits: KeptSplit[];
};

/** A split group as the file writes it, and what « Configurer et sélectionner » keeps of it. */
type KeptSplit = QifSplit & { kept: { category: string; tags: string[] } };

/** « Configurer et sélectionner »: Sure's `QifCategorySelectionsController#show`. */
export type QifPreview = {
	/** Sure's `valid_date_formats_with_preview`: the formats reading the first date, with that date. */
	dateFormats: { label: string; format: string; first: IsoDate }[];
	/** Each category of the rows and split lines, its row count, whether a split line holds it. */
	categories: { name: string; count: number; split: boolean }[];
	tags: { name: string; count: number }[];
	/** Sure's `has_split_transactions?`. */
	splits: boolean;
	/** Sure's `has_qif_accounts?`: the file names its accounts. */
	accounts: boolean;
};

/** The file read into Sure's rows, with what the rows do not show. */
export type QifSheet = {
	sheet: Sheet;
	facts: ReadonlyMap<number, RowFacts>;
	file: QifFile;
	/** The account chosen at upload, which takes the rows naming none. */
	chosen: string | null;
	preview: QifPreview;
	/** The choices as the page posts them back: the QIF date format and the selection. */
	configuration: ResolvedConfiguration;
};

/** Sure's `accountable_type_for_qif_type`, in Archant's types. */
function accountTypeOf(qifType: string): AccountType {
	switch (qifType) {
		case "CCard":
			return "credit_card";
		case "Invst":
			return "investment";
		case "Oth A":
			return "other_asset";
		case "Oth L":
			return "other_liability";
		default:
			return "depository";
	}
}

const negated = (decimal: string) =>
	decimal.startsWith("-") ? decimal.slice(1) : decimal === "0" ? decimal : `-${decimal}`;

/** Tags joined as Sure's rows hold them, `|` between, escaped as `splitTags` reads them back. */
const joinTags = (tags: readonly string[]) =>
	tags.map((tag) => tag.replaceAll(/[\\,|]/gu, (character) => `\\${character}`)).join("|");

/** Sure's `transaction_row_name`, in French: the payee, else what the action says. */
function cashLabelOf(action: string, payee: string, security: string, memo: string): string {
	if (payee !== "") {
		return payee;
	}

	const of = (label: string) => (security === "" ? label : `${label} : ${security}`);

	switch (action) {
		case "Div":
			return of("Dividende");
		case "IntInc":
			return of("Intérêts");
		case "XIn":
			return "Virement entrant";
		case "XOut":
			return "Virement sortant";
		case "CGLong":
			return of("Plus-value (long terme)");
		case "CGShort":
			return of("Plus-value (court terme)");
		case "MiscInc":
			return memo === "" ? "Revenu divers" : memo;
		case "MiscExp":
			return memo === "" ? "Dépense diverse" : memo;
		default:
			return action;
	}
}

/** Sure's `Trade.build_name`, in French. */
function tradeLabelOf(buy: boolean, quantity: string, ticker: string): string {
	return `${buy ? "Achat" : "Vente"} de ${quantity.replace(/^-/u, "")} actions ${ticker === "" ? "inconnues" : ticker}`;
}

/** A total as plain decimal text, else as written, which « Nettoyer » then refuses. */
const amountCell = (text: string) => decimalAmountOf(text) ?? text.trim();

/** The distinct names of `values` with how many rows hold each, sorted as Sure sorts them. */
function counted(values: readonly string[]): { name: string; count: number }[] {
	return keysOf(values.filter((value) => value.trim() !== "")).map(({ key, count }) => ({
		name: key,
		count,
	}));
}

/**
 * Reads a QIF file into Sure's rows: its `D` fields with the chosen format,
 * else the one `detect_date_format` finds; the categories and tags the
 * selection unchecks cleared, as `QifCategorySelectionsController#update`.
 * Refuses a file without `!Type:` (`QIF_INVALID`) and one naming no account
 * when none was chosen (`QIF_ACCOUNT_REQUIRED`).
 */
export function readQifSheet(
	input: {
		text: string;
		fileName: string;
		configuration: Configuration | undefined;
		edits: Edits | undefined;
		maxRows: number;
	},
	day: IsoDate,
	currency: CurrencyCode,
): QifSheet {
	const file = readQif(input.text, day);
	const chosen = input.configuration?.accountId ?? null;

	if (chosen === null && file.accounts.length === 0) {
		throw new AppError(
			"QIF_ACCOUNT_REQUIRED",
			"Choose the account a QIF file without accounts belongs to.",
		);
	}

	const offered: readonly string[] = DATE_FORMATS.map(([, format]) => format);
	const given = input.configuration?.dateFormat;
	const latest = yearsFrom(day, 5);
	// Sure's first date, the first one some format reads.
	const sample = file.dates.find((date) =>
		DATE_FORMATS.some(([, candidate]) => qifDateOf(date, candidate, day) !== null),
	);
	const dateFormats = DATE_FORMATS.flatMap(([label, candidate]) => {
		const first = sample === undefined ? null : qifDateOf(sample, candidate, day);

		return first !== null && first >= "1970-01-01" && first <= latest
			? [{ label, format: candidate, first }]
			: [];
	});
	const detected = detectDateFormat(file.dates, offered, day, QIF_DEFAULT_DATE_FORMAT);
	// The guess is one « Format de date » offers, else the first it offers.
	const format =
		given !== undefined && offered.includes(given)
			? given
			: dateFormats.some((candidate) => candidate.format === detected)
				? detected
				: (dateFormats[0]?.format ?? detected);

	const lineCategories = [
		...file.transactions,
		...file.investments.filter((record) => !isTrade(record.action)),
	];
	const splitCategories = new Set(
		file.transactions.flatMap((record) => record.splits.map((split) => split.category)),
	);
	const allCategories = counted(lineCategories.map((record) => record.category));

	for (const name of splitCategories) {
		if (name !== "" && !allCategories.some((category) => category.name === name)) {
			allCategories.push({ name, count: 0 });
		}
	}

	allCategories.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

	const allTags = counted(lineCategories.flatMap((record) => record.tags));

	for (const name of new Set(
		file.transactions.flatMap((record) => record.splits.flatMap((split) => split.tags)),
	)) {
		if (!allTags.some((tag) => tag.name === name)) {
			allTags.push({ name, count: 0 });
		}
	}

	allTags.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

	const keptCategories = new Set(
		input.configuration?.qifCategories ?? allCategories.map(({ name }) => name),
	);
	const keptTags = new Set(input.configuration?.qifTags ?? allTags.map(({ name }) => name));
	const category = (name: string) => (keptCategories.has(name) ? name : "");
	const tagsOf = (tags: readonly string[]) => tags.filter((tag) => keptTags.has(tag));
	const dateCell = (text: string) => qifDateOf(text, format, day) ?? text.trim();

	const rows: CsvRow[] = [];
	const facts = new Map<number, RowFacts>();
	const push = (cells: Record<Header, string>, fact: RowFacts) => {
		const line = rows.length + 1;

		rows.push({ line, cells: HEADERS.map((header) => cells[header]) });
		facts.set(line, fact);
	};
	const blank = { ticker: "", qty: "", price: "" };

	for (const record of file.transactions) {
		push(
			{
				date: dateCell(record.date),
				amount: amountCell(record.amount),
				name: record.payee,
				currency: "",
				category: category(record.category),
				tags: joinTags(tagsOf(record.tags)),
				account: record.account?.name ?? "",
				notes: record.memo,
				...blank,
			},
			{
				kind: "transaction",
				accountType: record.type,
				splits: record.splits.map((split) => ({
					...split,
					kept: { category: category(split.category), tags: tagsOf(split.tags) },
				})),
			},
		);
	}

	for (const record of file.investments) {
		const buy = BUY_ACTIONS.includes(record.action);
		const common = {
			date: dateCell(record.date),
			currency: "",
			account: record.account?.name ?? "",
			notes: record.memo,
		};

		if (isTrade(record.action)) {
			const quantity = qifDecimalOf(record.quantity) ?? record.quantity.trim();

			push(
				{
					...common,
					amount:
						record.amount === ""
							? ""
							: (decimalAmountOf(record.amount)?.replace(/^-/u, "") ?? record.amount.trim()),
					name: tradeLabelOf(buy, quantity, record.ticker),
					category: "",
					tags: "",
					ticker: record.ticker,
					qty: buy || qifDecimalOf(record.quantity) === null ? quantity : negated(quantity),
					price: qifDecimalOf(record.price) ?? record.price.trim(),
				},
				{ kind: "trade", accountType: record.type, splits: [] },
			);
		} else {
			const amount = decimalAmountOf(record.amount);
			const inflow = INFLOW_ACTIONS.includes(record.action);

			push(
				{
					...common,
					// Archant's sign (AD-5): money entering the account is positive.
					// `ShrsIn`, `StkSplit` and their kin move no cash: Sure writes them at zero.
					amount:
						record.amount.trim() === ""
							? "0"
							: amount === null
								? record.amount.trim()
								: inflow
									? amount
									: negated(amount),
					name: cashLabelOf(record.action, record.payee, record.security, record.memo),
					category: category(record.category),
					tags: joinTags(tagsOf(record.tags)),
					...blank,
				},
				{ kind: "cash", accountType: record.type, splits: [] },
			);
		}
	}

	if (rows.length > input.maxRows) {
		throw new AppError(
			"IMPORT_TOO_MANY_ROWS",
			`The file has more than ${input.maxRows} rows.`,
			undefined,
			{ max: String(input.maxRows) },
		);
	}

	const multiAccount = file.accounts.length > 0;
	const table: CsvTable = { headers: [...HEADERS], rows };
	const columns = Object.fromEntries(HEADERS.map((header) => [header, header]));
	const resolved: ResolvedConfiguration = {
		separator: ",",
		numberFormat: "1,234.56",
		dateFormat: ROW_DATE_FORMAT,
		signage: "inflows_positive",
		rowsToSkip: 0,
		amountTypeStrategy: "signed_amount",
		amountTypeIdentifier: null,
		amountTypeInflow: null,
		// A file naming its accounts reads each row's: one naming none goes to the chosen one.
		accountId: multiAccount ? null : chosen,
		columns,
	};
	const shape = {
		investment: file.firstType === "Invst",
		accounts: multiAccount,
		trades: file.investments.some((record) => isTrade(record.action)),
	};

	return {
		sheet: {
			type: "qif",
			fileName: input.fileName,
			table,
			lookup: headerLookup(table.headers),
			configuration: resolved,
			today: day,
			currency,
			edits: editsOf(input.edits, cleanColumnsOf("qif", null, shape)),
			qif: shape,
		},
		facts,
		file,
		chosen,
		preview: {
			dateFormats,
			categories: allCategories.map((item) => ({ ...item, split: splitCategories.has(item.name) })),
			tags: allTags,
			splits: file.transactions.some((record) => record.splits.length > 0),
			accounts: multiAccount,
		},
		configuration: {
			...resolved,
			accountId: chosen,
			dateFormat: format,
			qifCategories: [...keptCategories],
			qifTags: [...keptTags],
		},
	};
}

function isTrade(action: string): boolean {
	return BUY_ACTIONS.includes(action) || SELL_ACTIONS.includes(action);
}

/** How many values « Mapper » creates, Sure's `creational` mappings. */
const creating = (list: readonly { value: string | null }[]) =>
	list.filter((mapping) => mapping.value === CREATE_NEW_KEY).length;

/** One trade read whole, before its account is known by id. */
type ReadTrade = Omit<CsvTrade, "accountKey"> & { row: CsvRow; account: string };

/**
 * A split record's lines, as Sure's `import_split_lines!`: each its memo,
 * else its category as written, else the line's label, the category and
 * tags the selection keeps, the line's tags when the file gives it none;
 * `null` unless they sum to the line's amount exactly.
 */
function splitLinesOf(
	splits: readonly KeptSplit[],
	line: { amount: MinorUnits; currency: CurrencyCode; label: string; tags: string[] },
) {
	if (splits.length === 0 || splits.length > MAX_SPLIT_LINES) {
		return null;
	}

	const read = splits.map((split) => {
		const decimal = decimalAmountOf(split.amount);

		return {
			split,
			amount: decimal === null ? null : parseDecimalAmount(decimal, line.currency),
		};
	});

	if (
		read.some(({ amount }) => amount === null) ||
		read.reduce((total, { amount }) => total + (amount ?? 0), 0) !== line.amount
	) {
		return null;
	}

	return read.map(({ split, amount }) => ({
		label: cut(split.memo || split.category || line.label, LABEL_MAX_LENGTH),
		amount: amount ?? toMinorUnits(0),
		notes: split.memo === "" ? null : cut(split.memo, NOTES_MAX_LENGTH),
		category: split.kept.category,
		tags: split.tags.length > 0 ? split.kept.tags : line.tags,
	}));
}

/**
 * Sure's `QifImport#import!` over the rows: each line and cash line to its
 * account, a split record as split lines, each buy or sale a trade whose
 * total is its amount; « Mapper » maps the categories, the tags and, for a
 * file naming them, the accounts, preselected as Sure's
 * `find_or_create_qif_account`.
 */
export async function analyseQif(
	db: Pick<Transaction, "select">,
	qif: QifSheet,
	mappings: Mappings | undefined,
): Promise<Analysis> {
	const { sheet, facts, file, chosen } = qif;
	const errors: SureIssue[] = [];
	const stored = await db
		.select({
			id: accounts.id,
			name: accounts.name,
			type: accounts.type,
			subtype: accounts.subtype,
			currency: accounts.currency,
			active: accounts.active,
			bankAccountId: accounts.bankAccountId,
		})
		.from(accounts);
	const single = chosen === null ? undefined : stored.find((account) => account.id === chosen);

	if (chosen !== null && single?.active !== true) {
		throw new AppError("NOT_FOUND", "No account has this id.");
	}

	const kindOf = (row: CsvRow) => facts.get(row.line)?.kind ?? "transaction";
	const keyOf = (row: CsvRow) =>
		sheet.configuration.accountId === null ? (cellOf(sheet, row, "account") ?? "").trim() : "";
	// Sure's `accounts.manual`: a linked account takes its lines from its bank.
	const manual = stored.filter((account) => account.active && account.bankAccountId === null);
	const keys = keysOf(
		sheet.table.rows.map(keyOf).filter((key) => !(key === "" && single !== undefined)),
	);

	// Sure's `apply_opening_balances_or_adjust_anchors!` creates every account
	// the file names, one without a line included.
	for (const { name } of file.accounts) {
		if (!keys.some(({ key }) => key === name)) {
			keys.push({ key: name, count: 0 });
		}
	}

	keys.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
	const accountsMapped = qif.preview.accounts
		? valueMappings(
				keys,
				mappings?.accounts,
				new Set(manual.map((account) => account.id)),
				(key) => manual.find((account) => foldName(account.name) === foldName(key))?.id,
			)
		: [];
	const mapped = new Map(accountsMapped.map((mapping) => [mapping.key, mapping.value]));
	const byId = new Map(stored.map((account) => [account.id, account]));
	// An investment section's account holds trades whatever its own `T` says,
	// `Port` or `401(k)` among them.
	const typeOfKey = (key: string) => {
		const rows = sheet.table.rows.filter((row) => keyOf(row) === key);

		return rows.some((row) => kindOf(row) !== "transaction")
			? "Invst"
			: (file.accounts.find((account) => account.name === key)?.type ??
					facts.get(rows[0]?.line ?? 0)?.accountType ??
					"Bank");
	};
	// A row naming no account goes to the chosen one, else to the one
	// « Attribuez vos comptes » gives the blank name.
	const targetOf = (key: string) =>
		(key === "" && single !== undefined) || !qif.preview.accounts
			? (single?.id ?? null)
			: (mapped.get(key) ?? null);
	const currencyFor = (key: string): CurrencyCode | null => {
		const value = targetOf(key);
		const currency = value === CREATE_NEW_KEY ? sheet.currency : byId.get(value ?? "")?.currency;

		return currency !== undefined && isCurrencyCode(currency) ? currency : null;
	};

	const lineRows = sheet.table.rows.filter((row) => kindOf(row) !== "trade");
	const tradeRows = sheet.table.rows.filter((row) => kindOf(row) === "trade");
	const lines = readRows(
		{ ...sheet, table: { ...sheet.table, rows: lineRows } },
		currencyFor,
		errors,
	).map((item) => ({
		...item,
		account: keyOf(item.row),
		splits: splitLinesOf(facts.get(item.row.line)?.splits ?? [], item),
	}));
	const classes = await classificationsOf(
		db,
		[
			...lineRows.map((row) => categoryOf(sheet, row)),
			...lines.flatMap((item) => item.splits?.map((split) => split.category) ?? []),
		],
		[
			...lineRows.flatMap((row) => splitTags(cellOf(sheet, row, "tags") ?? "")),
			...lines.flatMap((item) => item.splits?.flatMap((split) => split.tags) ?? []),
		],
		mappings,
	);

	for (const item of lines) {
		classes.checkTags(item, errors);

		for (const split of item.splits ?? []) {
			classes.checkTags({ row: item.row, tags: split.tags }, errors);
		}
	}

	const trades = await readTrades(db, sheet, tradeRows, {
		keyOf,
		targetOf,
		currencyFor,
		trading: (key) => {
			const value = targetOf(key);
			const account = byId.get(value ?? "");

			return value === CREATE_NEW_KEY
				? typeOfKey(key) === "Invst"
				: account !== undefined && supportsTrades(account);
		},
		errors,
	});

	for (const mapping of accountsMapped) {
		if (mapping.value === null) {
			errors.push(csvIssue("unmapped_account", { key: mapping.key }));
		}
	}

	let created = 0;
	let importIds: string[] = [];

	return {
		counts: {
			transactions: lineRows.length,
			trades: trades.read.length,
			categories: creating(classes.categories),
			tags: creating(classes.tags),
			...(qif.preview.accounts ? { accounts: creating(accountsMapped) } : {}),
		},
		errors,
		mappings: { accounts: accountsMapped, categories: classes.categories, tags: classes.tags },
		write: async (tx, deps) => {
			const { categoryIds, tagIds } = await classes.write(tx);
			const ids = new Map<string, ImportedAccount>(stored.map((account) => [account.id, account]));
			const newIds = new Map<string, string>();
			const used = [
				...lines.map((item) => ({ key: item.account, date: item.date })),
				...trades.read.map((trade) => ({ key: trade.account, date: trade.date })),
			];

			// Sure's `find_or_create_qif_account`: one new account per name, of
			// the file's type, opened by its « Opening Balance » record.
			await oneByOne(accountsMapped, async ({ key, value }) => {
				const dates = used.filter((item) => item.key === key).map((item) => item.date);

				if (value !== CREATE_NEW_KEY) {
					return;
				}

				const [first] = dates.toSorted();
				const opening = file.openings.find((item) => item.account === key);
				const openingDate =
					opening === undefined
						? null
						: qifDateOf(opening.date, qif.configuration.dateFormat, sheet.today);
				const openingDecimal = opening === undefined ? null : decimalAmountOf(opening.amount);
				const openingAmount =
					openingDecimal === null ? null : parseDecimalAmount(openingDecimal, sheet.currency);
				const type = accountTypeOf(typeOfKey(key));
				const account = await createAccount(
					{ ...deps, db: tx },
					{
						name: cut(key, ACCOUNT_NAME_MAX_LENGTH),
						type,
						subtype: null,
						currency: sheet.currency,
						// Quicken writes a card's debt below zero, as a bank prints it (AD-5).
						openingBalance:
							openingDate === null || openingAmount === null
								? toMinorUnits(0)
								: toStoredBalance({ type }, openingAmount),
						openingDate: openingDate ?? addDays(first ?? sheet.today, -1),
					},
					{ origin: "user" },
				);

				ids.set(account.id, account);
				newIds.set(key, account.id);
			});

			const accountIdOf = (key: string) => {
				const target = targetOf(key);

				return target === CREATE_NEW_KEY ? (newIds.get(key) ?? null) : target;
			};
			const statements = new Map<string, NormalizedTransaction[]>();

			for (const item of lines) {
				const accountId = accountIdOf(item.account);

				if (accountId === null) {
					continue;
				}

				const splitLines: ImportedSplitLine[] | undefined = item.splits?.map((split) => ({
					label: split.label,
					amount: split.amount,
					notes: split.notes,
					categoryId: categoryIds.get(split.category) ?? null,
					tagIds: idsOf(tagIds, split.tags),
				}));
				const list = statements.get(accountId) ?? [];

				list.push({
					externalId: null,
					date: item.date,
					amount: item.amount,
					currency: item.currency,
					label: item.label,
					reference: null,
					notes: item.notes,
					pending: false,
					categoryId: categoryIds.get(item.category) ?? null,
					tagIds: idsOf(tagIds, item.tags),
					...(splitLines === undefined ? {} : { splitLines }),
				});
				statements.set(accountId, list);
			}

			const resolved: CsvStatement[] = [...statements].map(([accountId, list]) => ({
				accountId,
				lines: list,
			}));

			({ created, importIds } = await ingestCsvStatements(
				{ ...deps, db: tx },
				resolved,
				sheet.fileName,
				"qif",
			));

			const written = trades.read.flatMap(({ row: _row, account, ...trade }): CsvTrade[] => {
				const accountId = accountIdOf(account);

				return accountId === null ? [] : [{ ...trade, accountKey: accountId }];
			});

			if (written.length > 0) {
				await insertCsvTrades(
					tx,
					{ existing: ids, newAccounts: [], trades: written },
					{ now: Date.now(), timeZone: deps.timeZone },
				);
			}
		},
		committed: async (deps) => {
			const [importId] = importIds;

			if (importId === undefined) {
				return;
			}

			if (created > STATISTICS_REFRESH_LINES) {
				await refreshAfterImport(deps, importId);
			}

			await detectAfterImport(deps, importId);
		},
	};
}

/**
 * Each buy or sale row, as Sure's `import_investment_rows!`: its quantity
 * signed, its total the trade's amount, what the total adds to `quantity ×
 * price` its fee; a total below that, a rounded price, leaves the fee at
 * zero, Archant's fee never being negative. Refused on its row: a blank
 * ticker, an account that takes no trade, another currency than its
 * account's, a security held in another currency, an amount no balance holds.
 */
async function readTrades(
	db: Pick<Transaction, "select">,
	sheet: Sheet,
	rows: readonly CsvRow[],
	context: {
		keyOf: (row: CsvRow) => string;
		targetOf: (key: string) => string | null;
		currencyFor: (key: string) => CurrencyCode | null;
		trading: (key: string) => boolean;
		errors: SureIssue[];
	},
): Promise<{ read: ReadTrade[] }> {
	const { errors } = context;
	const read: ReadTrade[] = [];
	const held = new Map<string, string>();

	await oneByOne(rows, async (row) => {
		const before = errors.length;
		const key = context.keyOf(row);
		const dateText = cellOf(sheet, row, "date") ?? "";

		if (dateText === "") {
			errors.push(csvIssue("required", { line: lineOf(row), field: "date" }));
		}

		const date = dateText === "" ? null : dateOf(sheet, row, dateText, errors);
		const ticker = (cellOf(sheet, row, "ticker") ?? "").trim().toUpperCase();
		const quantityText = numberOf(sheet, row, "qty", errors);
		const priceText = numberOf(sheet, row, "price", errors);
		const quantity = quantityText === null ? null : parseQuantity(quantityText);
		const price = priceText === null ? null : parseTradePrice(priceText);

		if (quantityText !== null && quantity === null) {
			errors.push(csvIssue("invalid_number", { line: lineOf(row), field: "qty" }));
		}

		if (priceText !== null && price === null) {
			errors.push(csvIssue("invalid_number", { line: lineOf(row), field: "price" }));
		}

		if (ticker === "") {
			errors.push(csvIssue("required", { line: lineOf(row), field: "ticker" }));
		}

		const target = context.targetOf(key);

		if (target !== null && !context.trading(key)) {
			errors.push(csvIssue("trades_not_supported", { line: lineOf(row), field: "account" }));
		}

		const accountCurrency = context.currencyFor(key);
		const currency = currencyOf(sheet, row, accountCurrency, errors);

		if (currency !== null && accountCurrency !== null && currency !== accountCurrency) {
			errors.push(
				csvIssue("CURRENCY_MISMATCH", {
					line: lineOf(row),
					currency,
					account: accountCurrency,
				}),
			);
		}

		const totalText = (cellOf(sheet, row, "amount") ?? "").trim();
		const totalDecimal = totalText === "" ? null : numberOf(sheet, row, "amount", errors);

		if (
			errors.length > before ||
			date === null ||
			quantity === null ||
			price === null ||
			accountCurrency === null ||
			target === null ||
			// The export's dividends at quantity zero: Sure's trade of amount zero moves nothing.
			scaledQuantity(quantity) === 0n
		) {
			return;
		}

		const total =
			totalDecimal === null
				? null
				: parseDecimalAmount(totalDecimal.replace(/^-/u, ""), accountCurrency);

		if (totalDecimal !== null && total === null) {
			errors.push(csvIssue("invalid_number", { line: lineOf(row), field: "amount" }));

			return;
		}

		const side = scaledQuantity(quantity) > 0n ? "buy" : "sell";
		const fee =
			(total === null
				? null
				: conversionFee(
						side,
						{ quantity: unsignedQuantity(quantity), price },
						toMinorUnits(side === "buy" ? 0 - total : total),
						accountCurrency,
					)) ?? toMinorUnits(0);
		const trade = { quantity, price, fee };
		const amount = tradeAmount(trade, accountCurrency);

		if (amount === null || !buyCostFits(trade, accountCurrency)) {
			errors.push(csvIssue("trade_too_large", { line: lineOf(row) }));

			return;
		}

		const security = listingOf(ticker, null);
		const currencyHeld = held.get(ticker) ?? (await storedListing(db, security))?.currency;

		if (currencyHeld !== undefined && currencyHeld !== accountCurrency) {
			errors.push(csvIssue("security_currency", { line: lineOf(row), ticker }));

			return;
		}

		held.set(ticker, accountCurrency);
		read.push({
			row,
			account: key,
			date,
			ticker,
			mic: null,
			quantity,
			price,
			amount,
			fee,
		});
	});

	return { read };
}
