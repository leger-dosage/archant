import type { IsoDate } from "../domain/dates.ts";
import type { NormalizedTransaction } from "../domain/statement.ts";
import type { CsvRow } from "./csv-import-format.ts";
import type { Analysis, Mappings, Sheet, ValueMapping } from "./csv-import-sheet.ts";
import type { AmountTerm } from "./csv-import-tools.ts";
import type { CsvStatement } from "./ledger/csv-transactions.ts";
import type { Transaction } from "./ledger/shared.ts";
import type { SureIssue } from "./sure-import-preflight.ts";

import type { CategoryKind } from "@archant/data/category-presets";
import { CATEGORY_NAME_MAX_LENGTH, newCategory } from "@archant/data/category-presets";
import type { CurrencyCode, MinorUnits } from "@archant/data/money";
import { isCurrencyCode, parseDecimalAmount, toMinorUnits } from "@archant/data/money";
import { TAG_NAME_MAX_LENGTH } from "@archant/data/name-limits";
import { accounts } from "@archant/data/schema/accounts";
import { categories } from "@archant/data/schema/categories";
import { tags } from "@archant/data/schema/tags";

import { addDays } from "../domain/dates.ts";
import { AppError } from "../lib/errors.ts";
import { ACCOUNT_NAME_MAX_LENGTH } from "../schemas/accounts.ts";
import { CREATE_NEW_KEY } from "../schemas/csv-imports.ts";
import {
	LABEL_MAX_LENGTH,
	MAX_TAGS_PER_TRANSACTION,
	NOTES_MAX_LENGTH,
} from "../schemas/transactions.ts";
import { csvIssue, splitTags } from "./csv-import-format.ts";
import { cellOf, currencyOf, dateOf, keysOf, lineOf, valueMappings } from "./csv-import-sheet.ts";
import { amountTermsOf, categoryOf, rawLabelOf } from "./csv-import-tools.ts";
import { STATISTICS_REFRESH_LINES, detectAfterImport, refreshAfterImport } from "./imports.ts";
import { createAccount } from "./ledger/accounts.ts";
import { ingestCsvStatements } from "./ledger/csv-transactions.ts";
import { oneByOne } from "./ledger/shared.ts";
import { cut } from "./sure-import-plan.ts";
import { foldName } from "./sure-import-preflight.ts";

// Sure's `TransactionImport` at 00dd977fb, and the `MintImport`,
// `YnabImport` and `ActualImport` built on it: each row a transaction of the
// chosen account, or of the one « Attribuez vos comptes » maps its account
// name to, filed under the categories and tags « Attribuez vos catégories »
// and « Attribuez vos étiquettes » map. Each account's lines then go through
// the ledger's pipeline (AD-4) under an import of their own.

/** Sure's `default_row_name`, in French: a label Archant requires. */
const DEFAULT_LABEL = "Opération importée";

/** One row read whole: what its line needs once the mappings are applied. */
type ReadRow = {
	row: CsvRow;
	date: IsoDate;
	amount: MinorUnits;
	currency: CurrencyCode;
	label: string;
	notes: string | null;
	account: string;
	category: string;
	tags: string[];
};

type StoredCategory = { id: string; name: string; kind: CategoryKind; color: string };

/**
 * Sure's `CategoryMapping` key looked up by its leaf: « Maison:Jardin »
 * finds « Jardin », since a name is unique in the household.
 */
function leafOf(key: string): string {
	const [parent, child] = splitCategory(key);

	return child ?? parent;
}

/**
 * A `Parent:Child` key as its two names, trimmed; a plain key as one, and so
 * is a key with a blank side, such as `Maison:`, which names no child.
 */
function splitCategory(key: string): [string, string | undefined] {
	const at = key.indexOf(":");
	const parent = key.slice(0, at).trim();
	const child = key.slice(at + 1).trim();

	if (at === -1 || parent === "" || child === "") {
		return [at === -1 ? key : parent || child, undefined];
	}

	return [parent, child];
}

const categoryName = (name: string) => cut(name.trim().normalize("NFC"), CATEGORY_NAME_MAX_LENGTH);

const tagName = (name: string) => cut(name.trim().normalize("NFC"), TAG_NAME_MAX_LENGTH);

/**
 * Sure's `apply_transaction_signage_convention`, in Archant's sign (AD-5),
 * where money in is positive: Sure stores an expense positive.
 */
function signed(sheet: Sheet, row: CsvRow, amount: MinorUnits): MinorUnits {
	const { amountTypeStrategy, amountTypeIdentifier, amountTypeInflow, signage } =
		sheet.configuration;
	const negated = toMinorUnits(0 - amount);

	if (amountTypeStrategy === "signed_amount") {
		return signage === "inflows_positive" ? amount : negated;
	}

	const marked = (cellOf(sheet, row, "entity_type") ?? "") === amountTypeIdentifier;
	const inflows = amountTypeInflow === "inflows_positive";

	return marked === inflows ? amount : negated;
}

/**
 * A row's amount in `currency`'s minor units: its terms summed, an outflow
 * term counted by its size; `null` when one has more decimals than the
 * currency holds.
 */
function sumOf(terms: readonly AmountTerm[], currency: CurrencyCode): MinorUnits | null {
	let sum = 0;

	for (const { decimal, sign, absolute } of terms) {
		const amount = parseDecimalAmount(decimal, currency);

		if (amount === null) {
			return null;
		}

		sum += sign * (absolute ? Math.abs(amount) : amount);
	}

	return toMinorUnits(sum);
}

/** Each row's cells read, an issue on its line for what does not. */
export function readRows(
	sheet: Sheet,
	accountCurrency: (key: string) => CurrencyCode | null,
	errors: SureIssue[],
): ReadRow[] {
	return sheet.table.rows.flatMap((row): ReadRow[] => {
		const before = errors.length;
		const dateText = cellOf(sheet, row, "date") ?? "";

		if (dateText === "") {
			errors.push(csvIssue("required", { line: lineOf(row), field: "date" }));
		}

		const date = dateText === "" ? null : dateOf(sheet, row, dateText, errors);
		const terms = amountTermsOf(sheet, row, errors);
		const account =
			sheet.configuration.accountId === null ? (cellOf(sheet, row, "account") ?? "") : "";
		const expected = accountCurrency(account);
		const currency = currencyOf(sheet, row, expected ?? sheet.currency, errors);

		if (currency !== null && expected !== null && currency !== expected) {
			errors.push(
				csvIssue("CURRENCY_MISMATCH", { line: lineOf(row), currency, account: expected }),
			);
		}

		const amount = terms === null || currency === null ? null : sumOf(terms, currency);

		if (terms !== null && currency !== null && amount === null) {
			errors.push(csvIssue("invalid_number", { line: lineOf(row), field: "amount" }));
		}

		if (errors.length > before || date === null || amount === null || currency === null) {
			return [];
		}

		const label = rawLabelOf(sheet, row).replaceAll(/\s+/gu, " ").trim();
		const notes = (cellOf(sheet, row, "notes") ?? "").trim();

		return [
			{
				row,
				date,
				amount: signed(sheet, row, amount),
				currency,
				label: cut(label === "" ? DEFAULT_LABEL : label, LABEL_MAX_LENGTH),
				notes: notes === "" ? null : cut(notes, NOTES_MAX_LENGTH),
				account,
				category: categoryOf(sheet, row),
				tags: splitTags(cellOf(sheet, row, "tags") ?? ""),
			},
		];
	});
}

/**
 * Sure's `CategoryMapping#create_mappable!`: a key `Parent:Child` files the
 * child, found by name or created with its parent's colour and kind, under a
 * root parent found or created; any other key is the category of that name
 * or a new one. Returns the category the key maps to.
 */
async function createCategory(
	tx: Transaction,
	byName: Map<string, StoredCategory & { parentId: string | null }>,
	key: string,
	now: number,
): Promise<string> {
	const insert = async (name: string, parent: StoredCategory | null) => {
		const preset = newCategory(name);
		const created = {
			id: crypto.randomUUID(),
			name,
			kind: parent?.kind ?? preset.kind,
			color: parent?.color ?? preset.color,
			icon: preset.icon,
			parentId: parent?.id ?? null,
		};

		await tx.insert(categories).values({ ...created, createdAt: now, updatedAt: now });
		byName.set(foldName(name), created);

		return created;
	};
	const [first, child] = splitCategory(key);

	if (child === undefined) {
		const name = categoryName(first);

		return (byName.get(foldName(name)) ?? (await insert(name, null))).id;
	}

	const parentName = categoryName(first);
	const existing = byName.get(foldName(parentName));
	const parent =
		existing === undefined
			? await insert(parentName, null)
			: existing.parentId === null
				? existing
				: [...byName.values()].find((category) => category.id === existing.parentId);
	const name = categoryName(child);

	return (byName.get(foldName(name)) ?? (await insert(name, parent ?? null))).id;
}

/** How many values « Mapper » creates, Sure's `creational` mappings. */
const creating = (list: readonly ValueMapping[]) =>
	list.filter((mapping) => mapping.value === CREATE_NEW_KEY).length;

/** The ids `names` map to, once each, those mapped to none left out. */
export const idsOf = (ids: ReadonlyMap<string, string | null>, names: readonly string[]) => [
	...new Set(
		names.flatMap((name) => {
			const id = ids.get(name) ?? null;

			return id === null ? [] : [id];
		}),
	),
];

/**
 * « Attribuez vos catégories » and « Attribuez vos étiquettes » over the
 * file's category and tag keys, preselected as Sure's `sync_mappings`: the
 * category whose name is the key's leaf, the tag of that name, else a new
 * one. `checkTags` refuses a row with more tags than a line holds; `write`
 * creates what « Ajouter comme nouvelle … » asked for and gives each key its id.
 */
export async function classificationsOf(
	db: Pick<Transaction, "select">,
	categoryKeys: readonly string[],
	tagKeys: readonly string[],
	mappings: Mappings | undefined,
) {
	const storedCategories = await db
		.select({
			id: categories.id,
			name: categories.name,
			kind: categories.kind,
			color: categories.color,
			parentId: categories.parentId,
		})
		.from(categories);
	const categoryByName = new Map(storedCategories.map((row) => [foldName(row.name), row]));
	const categoriesMapped = valueMappings(
		keysOf(categoryKeys),
		mappings?.categories,
		new Set(storedCategories.map((row) => row.id)),
		(key) => (key.trim() === "" ? undefined : categoryByName.get(foldName(leafOf(key)))?.id),
		(key) => categoryName(leafOf(key)) !== "",
	);
	const storedTags = await db.select({ id: tags.id, name: tags.name }).from(tags);
	const tagByName = new Map(storedTags.map((row) => [foldName(row.name), row.id]));
	const tagsMapped = valueMappings(
		keysOf(tagKeys),
		mappings?.tags,
		new Set(storedTags.map((row) => row.id)),
		(key) => (key.trim() === "" ? undefined : tagByName.get(foldName(tagName(key)))),
	);
	const tagOf = new Map(tagsMapped.map((mapping) => [mapping.key, mapping.value]));
	// A new tag is one per folded name, however many keys spell it.
	const tagTarget = (key: string) => {
		const value = tagOf.get(key) ?? null;

		return value === CREATE_NEW_KEY ? `new ${foldName(tagName(key))}` : value;
	};

	return {
		categories: categoriesMapped,
		tags: tagsMapped,
		checkTags: (item: { row: CsvRow; tags: readonly string[] }, errors: SureIssue[]) => {
			const targets = new Set(item.tags.map(tagTarget).filter((target) => target !== null));

			if (targets.size > MAX_TAGS_PER_TRANSACTION) {
				errors.push(
					csvIssue("too_many_tags", {
						line: lineOf(item.row),
						max: String(MAX_TAGS_PER_TRANSACTION),
					}),
				);
			}
		},
		write: async (tx: Transaction) => {
			const now = Date.now();
			const categoryIds = new Map<string, string | null>();
			const byName = new Map(categoryByName);

			await oneByOne(categoriesMapped, async ({ key, value }) => {
				categoryIds.set(
					key,
					value === CREATE_NEW_KEY ? await createCategory(tx, byName, key, now) : value,
				);
			});

			const tagIds = new Map<string, string | null>();
			const tagsByName = new Map(tagByName);

			await oneByOne(tagsMapped, async ({ key, value }) => {
				if (value !== CREATE_NEW_KEY) {
					tagIds.set(key, value);

					return;
				}

				const name = tagName(key);
				let id = tagsByName.get(foldName(name));

				if (id === undefined) {
					id = crypto.randomUUID();
					await tx.insert(tags).values({ id, name, createdAt: now, updatedAt: now });
					tagsByName.set(foldName(name), id);
				}

				tagIds.set(key, id);
			});

			return { categoryIds, tagIds };
		},
	};
}

/**
 * Sure's `TransactionImport`: reads every row, maps its account, category
 * and tags, and counts what publishing creates, Sure's `dry_run`. A row in
 * another currency than its account is refused, Archant converting none.
 */
export async function analyseTransactions(
	db: Pick<Transaction, "select">,
	sheet: Sheet,
	mappings: Mappings | undefined,
): Promise<Analysis> {
	const errors: SureIssue[] = [];
	const { amountTypeStrategy, amountTypeIdentifier, amountTypeInflow, accountId } =
		sheet.configuration;
	const stored = await db
		.select({
			id: accounts.id,
			name: accounts.name,
			currency: accounts.currency,
			active: accounts.active,
			bankAccountId: accounts.bankAccountId,
		})
		.from(accounts);
	const single =
		accountId === null ? undefined : stored.find((account) => account.id === accountId);

	if (accountId !== null && single?.active !== true) {
		throw new AppError("NOT_FOUND", "No account has this id.");
	}

	if (
		amountTypeStrategy === "custom_column" &&
		((sheet.configuration.columns.entity_type ?? null) === null ||
			amountTypeIdentifier === null ||
			amountTypeInflow === null)
	) {
		errors.push(csvIssue("custom_column_requires_inflow"));
	}

	// Sure's `accounts.manual`: a linked account takes its lines from its bank.
	const manual = stored.filter((account) => account.active && account.bankAccountId === null);
	const accountKeys =
		single === undefined
			? keysOf(sheet.table.rows.map((row) => cellOf(sheet, row, "account") ?? ""))
			: [];
	const accountsMapped = valueMappings(
		accountKeys,
		mappings?.accounts,
		new Set(manual.map((account) => account.id)),
		(key) => manual.find((account) => foldName(account.name) === foldName(key))?.id,
	);
	const accountOf = new Map(accountsMapped.map((mapping) => [mapping.key, mapping.value]));
	const currencies = new Map(stored.map((account) => [account.id, account.currency]));
	const currencyFor = (key: string): CurrencyCode | null => {
		const value = single?.id ?? accountOf.get(key) ?? null;
		const currency = value === CREATE_NEW_KEY ? sheet.currency : currencies.get(value ?? "");

		return currency !== undefined && isCurrencyCode(currency) ? currency : null;
	};
	const read = readRows(sheet, currencyFor, errors);

	const classes = await classificationsOf(
		db,
		sheet.table.rows.map((row) => categoryOf(sheet, row)),
		sheet.table.rows.flatMap((row) => splitTags(cellOf(sheet, row, "tags") ?? "")),
		mappings,
	);
	const categoriesMapped = classes.categories;
	const tagsMapped = classes.tags;

	for (const item of read) {
		classes.checkTags(item, errors);
	}

	for (const mapping of accountsMapped) {
		if (mapping.value === null) {
			errors.push(csvIssue("unmapped_account", { key: mapping.key }));
		}
	}

	let created = 0;
	let importIds: string[] = [];

	return {
		counts: {
			transactions: sheet.table.rows.length,
			categories: creating(categoriesMapped),
			tags: creating(tagsMapped),
			...(single === undefined ? { accounts: creating(accountsMapped) } : {}),
		},
		errors,
		mappings: { accounts: accountsMapped, categories: categoriesMapped, tags: tagsMapped },
		write: async (tx, deps) => {
			const { categoryIds, tagIds } = await classes.write(tx);

			// The lines of each account, in file order, the accounts in the order the file names them.
			const statements = new Map<string, NormalizedTransaction[]>();
			const newNames = new Map<string, string>();

			for (const item of read) {
				const target = single?.id ?? accountOf.get(item.account) ?? null;
				// A new account is one per folded name, however many keys spell it,
				// named as the file first spells it.
				const folded = foldName(item.account);
				const key = target === CREATE_NEW_KEY ? `new ${folded}` : target;

				if (target === CREATE_NEW_KEY && !newNames.has(folded)) {
					newNames.set(folded, item.account.trim());
				}

				if (key === null) {
					continue;
				}

				const line: NormalizedTransaction = {
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
				};

				const list = statements.get(key) ?? [];

				list.push(line);
				statements.set(key, list);
			}

			const resolved: CsvStatement[] = [];

			await oneByOne([...statements], async ([key, lines]) => {
				if (!key.startsWith("new ")) {
					resolved.push({ accountId: key, lines });

					return;
				}

				const [first] = lines.map((line) => line.date).toSorted();
				const account = await createAccount(
					{ ...deps, db: tx },
					{
						name: cut(newNames.get(key.slice(4)) ?? key.slice(4), ACCOUNT_NAME_MAX_LENGTH),
						type: "depository",
						subtype: null,
						currency: sheet.currency,
						openingBalance: toMinorUnits(0),
						openingDate: addDays(first ?? sheet.today, -1),
					},
					{ origin: "user" },
				);

				resolved.push({ accountId: account.id, lines });
			});

			({ created, importIds } = await ingestCsvStatements(
				{ ...deps, db: tx },
				resolved,
				sheet.fileName,
			));
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
