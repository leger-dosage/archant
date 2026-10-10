import type { CashFlowRow } from "../../domain/cash-flow.ts";
import type { IsoDate, IsoMonth } from "../../domain/dates.ts";
import type { ServiceDeps } from "../deps.ts";
import type { TransactionFilter } from "./filter.ts";
import type { Transaction, TransferColumns } from "./shared.ts";
import type { SQL } from "drizzle-orm";

import { and, asc, count, desc, eq, inArray, not, notInArray, sql, sum } from "drizzle-orm";

import type { AccountType } from "@archant/data/account-types";
import { TAX_ADVANTAGED_SUBTYPES } from "@archant/data/account-types";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { BANK_CONNECTOR_IDS } from "@archant/data/schema/bank-connections";
import type { BankConnectorId } from "@archant/data/schema/bank-connections";
import { entries } from "@archant/data/schema/entries";
import { entryKeys } from "@archant/data/schema/entry-keys";
import type { FileSourceId } from "@archant/data/schema/imports";
import { imports } from "@archant/data/schema/imports";
import { transactions } from "@archant/data/schema/transactions";
import type { TransferKind, TransferStatus } from "@archant/data/transfer-kinds";

import { both, filterCondition, joinedTransferSide, needsTransactionColumns } from "./filter.ts";
import { tagIdsByEntry, tagIdsOf } from "./patch.ts";
import {
	KEYS_PER_LOOKUP,
	asInflow,
	asOutflow,
	counterpartAccount,
	counterpartEntry,
	counterpartIdOf,
	inSequence,
	transferColumns,
} from "./shared.ts";

export type TransactionRecord = {
	id: string;
	accountId: string;
	date: IsoDate;
	amount: MinorUnits;
	currency: string;
	label: string;
	notes: string | null;
	/** A cheque or QIF `N` number from the import that created it. */
	reference: string | null;
	/** Left out of reports (AD-9), still counted in the balance. */
	excluded: boolean;
	/** Not booked by the bank yet: counted in the balance, left out of cash flow (AD-8, AD-9). */
	pending: boolean;
	/** `null` is « Sans catégorie ». */
	categoryId: string | null;
	/** `null` is « Sans marchand ». */
	merchantId: string | null;
	/** Sorted by id; the interface sorts the names. */
	tagIds: string[];
	/** The transfer it is a side of, with the other side's account. */
	transfer: TransferLink | null;
	/**
	 * Created by an import or a sync that found two entries equally near it
	 * (AD-7), until the user merges or dismisses it.
	 */
	possibleDuplicate: boolean;
	/**
	 * The transaction this one is a split line of (AD-20), `null` for an
	 * unsplit transaction or a split's parent.
	 */
	parentEntryId: string | null;
};

/**
 * A transaction's transfer as its row shows it. Which side it is follows from
 * its amount: the outflow is the negative one.
 */
type TransferLink = {
	id: string;
	kind: TransferKind;
	/** `pending` while the owner has not confirmed what the matcher proposed. */
	status: TransferStatus;
	counterpartTransactionId: string;
	counterpartAccountId: string;
	counterpartAccountName: string;
};

/**
 * A transaction as a list shows it, with its account's name and type, read in
 * the same join so a row of an inactive or hidden account still gets its icon.
 */
export type TransactionListRecord = TransactionRecord & {
	accountName: string;
	accountType: AccountType;
};

const transactionColumns = {
	id: entries.id,
	accountId: entries.accountId,
	date: entries.date,
	amount: entries.amount,
	currency: entries.currency,
	label: transactions.label,
	notes: transactions.notes,
	reference: transactions.reference,
	excluded: transactions.excluded,
	pending: transactions.pending,
	possibleDuplicate: transactions.possibleDuplicate,
	categoryId: transactions.categoryId,
	merchantId: transactions.merchantId,
	parentEntryId: entries.parentEntryId,
};

function toRecord<Row extends { amount: number }>(row: Row): Row & { amount: MinorUnits } {
	return { ...row, amount: toMinorUnits(row.amount) };
}

/** Folds the transfer columns of a row into its `transfer`. */
function withTransferLink<Row extends TransferColumns>(
	row: Row,
): Omit<Row, keyof TransferColumns> & { transfer: TransferLink | null } {
	const {
		transferId,
		transferKind,
		transferStatus,
		counterpartTransactionId,
		counterpartAccountId,
		counterpartAccountName,
		...rest
	} = row;

	return {
		...rest,
		transfer:
			transferId === null ||
			transferKind === null ||
			transferStatus === null ||
			counterpartTransactionId === null ||
			counterpartAccountId === null ||
			counterpartAccountName === null
				? null
				: {
						id: transferId,
						kind: transferKind,
						status: transferStatus,
						counterpartTransactionId,
						counterpartAccountId,
						counterpartAccountName,
					},
	};
}

/**
 * Where a keyed entry came from: a file import, `confirmedAt` in epoch
 * milliseconds, or a bank connector.
 */
export type EntryOrigin =
	| { kind: "import"; source: FileSourceId; confirmedAt: number | null }
	| { kind: "bank"; connector: BankConnectorId };

/**
 * The origin of each of `entryIds` that has keys; manual entries are absent.
 * A bank's key wins over a file's: an entry a sync paired with is fed by the
 * bank from then on.
 */
export async function entryOrigins(
	deps: ServiceDeps,
	entryIds: readonly string[],
): Promise<Map<string, EntryOrigin>> {
	const found = new Map<string, EntryOrigin>();

	await inSequence(entryIds, KEYS_PER_LOOKUP, async (chunk) => {
		const imported = await deps.db
			.selectDistinct({
				entryId: entryKeys.entryId,
				source: imports.source,
				confirmedAt: imports.confirmedAt,
			})
			.from(entryKeys)
			.innerJoin(imports, eq(imports.id, entryKeys.importId))
			.where(inArray(entryKeys.entryId, chunk));
		const synced = await deps.db
			.selectDistinct({
				entryId: entryKeys.entryId,
				// Narrowed by the `where` below, which the column type cannot see.
				connector: sql<BankConnectorId>`${entryKeys.source}`,
			})
			.from(entryKeys)
			.where(and(inArray(entryKeys.entryId, chunk), inArray(entryKeys.source, BANK_CONNECTOR_IDS)));

		for (const { entryId, ...origin } of imported) {
			found.set(entryId, { kind: "import", ...origin });
		}

		for (const { entryId, connector } of synced) {
			found.set(entryId, { kind: "bank", connector });
		}
	});

	return found;
}

/** One transaction, `null` when the id names none. */
export async function findTransaction(
	deps: ServiceDeps,
	entryId: string,
): Promise<TransactionRecord | null> {
	const row = await deps.db
		.select({ ...transactionColumns, ...transferColumns })
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.leftJoin(asOutflow, eq(asOutflow.outflowTransactionId, entries.id))
		.leftJoin(asInflow, eq(asInflow.inflowTransactionId, entries.id))
		.leftJoin(counterpartEntry, eq(counterpartEntry.id, counterpartIdOf))
		.leftJoin(counterpartAccount, eq(counterpartAccount.id, counterpartEntry.accountId))
		.where(eq(entries.id, entryId))
		.get();

	if (row === undefined) {
		return null;
	}

	return { ...withTransferLink(toRecord(row)), tagIds: await tagIdsOf(deps.db, entryId) };
}

/**
 * The list's select: each transaction with its transfer and its account's
 * name and type. `listTransactionPage` and `listTransactionsById` narrow it.
 */
function listSelect(db: Pick<Transaction, "select">) {
	return db
		.select({
			...transactionColumns,
			...transferColumns,
			accountName: accounts.name,
			accountType: accounts.type,
		})
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.innerJoin(accounts, eq(accounts.id, entries.accountId))
		.leftJoin(asOutflow, eq(asOutflow.outflowTransactionId, entries.id))
		.leftJoin(asInflow, eq(asInflow.inflowTransactionId, entries.id))
		.leftJoin(counterpartEntry, eq(counterpartEntry.id, counterpartIdOf))
		.leftJoin(counterpartAccount, eq(counterpartAccount.id, counterpartEntry.accountId))
		.$dynamic();
}

// A pending row sits at the top of its day: the bank has not settled it yet.
const listOrder = [
	desc(entries.date),
	desc(transactions.pending),
	desc(entries.createdAt),
	desc(entries.id),
];

/** Sure's `get_transactions` sort: by date or by absolute amount, either way. */
export type ListSort = { by: "date" | "amount"; order: "asc" | "desc" };

/** The list's order reversed, oldest first. */
const oldestFirst = [
	asc(entries.date),
	asc(transactions.pending),
	asc(entries.createdAt),
	asc(entries.id),
];

/**
 * Sure's `ABS(entries.amount)`, then the most recent first. No column of
 * `transactions`: `largestIds` sorts the entries alone.
 */
function bySize(order: ListSort["order"]) {
	const size = sql`abs(${entries.amount})`;

	return [
		order === "asc" ? asc(size) : desc(size),
		desc(entries.date),
		desc(entries.createdAt),
		desc(entries.id),
	];
}

/**
 * A page of the ids `where` matches, by absolute amount. Every row is read to
 * sort by a computed size, so the joins of `listSelect` would run on each of
 * them; here only those `where` reads do, and `listSelect` reads the page.
 */
async function idsBySize(
	deps: ServiceDeps,
	filter: TransactionFilter,
	where: SQL | undefined,
	page: { page: number; pageSize: number; order: ListSort["order"] },
): Promise<string[]> {
	const query = deps.db
		.select({ id: entries.id })
		.from(entries)
		.leftJoin(asOutflow, eq(asOutflow.outflowTransactionId, entries.id))
		.leftJoin(asInflow, eq(asInflow.inflowTransactionId, entries.id))
		.$dynamic();
	const rows = await (
		needsTransactionColumns(filter)
			? query.innerJoin(transactions, eq(transactions.entryId, entries.id))
			: query
	)
		.where(where)
		.orderBy(...bySize(page.order))
		.limit(page.pageSize)
		.offset((page.page - 1) * page.pageSize);

	return rows.map((row) => row.id);
}

/** The rows of `listSelect` as records, with their tags. */
async function listRecordsOf(
	db: Pick<Transaction, "select">,
	rows: Awaited<ReturnType<typeof listSelect>>,
): Promise<TransactionListRecord[]> {
	const tagsOf = await tagIdsByEntry(
		db,
		rows.map((row) => row.id),
	);
	return rows.map((row) => ({
		...withTransferLink(toRecord(row)),
		tagIds: tagsOf.get(row.id) ?? [],
	}));
}

/**
 * A page of transactions matching `filter`, most recent first (AD-15), each
 * with its account's name, and no count: the cross-account list asks for its
 * totals apart, once per filter rather than once per page.
 */
export async function listTransactionPage(
	deps: ServiceDeps,
	filter: TransactionFilter,
	page: { page: number; pageSize: number; sort?: ListSort | undefined },
): Promise<TransactionListRecord[]> {
	const where = filterCondition(filter, joinedTransferSide);

	if (where === null) {
		return [];
	}

	if (page.sort?.by === "amount") {
		const ids = await idsBySize(deps, filter, where, { ...page, order: page.sort.order });
		const rows = await listSelect(deps.db)
			.where(inArray(entries.id, ids))
			.orderBy(...bySize(page.sort.order));

		return listRecordsOf(deps.db, rows);
	}

	const rows = await listSelect(deps.db)
		.where(where)
		.orderBy(...(page.sort?.order === "asc" ? oldestFirst : listOrder))
		.limit(page.pageSize)
		.offset((page.page - 1) * page.pageSize);

	return listRecordsOf(deps.db, rows);
}

/**
 * The transactions `ids` names, as the list shows them, with no filter and in
 * the list's order; an unknown id is absent. The list reads a page's split
 * parents through it, which no filter keeps, as Sure's `@split_parents`. One
 * query: a page's ids stay under SQLite's bound on parameters.
 */
export async function listTransactionsById(
	deps: ServiceDeps,
	ids: readonly string[],
): Promise<TransactionListRecord[]> {
	if (ids.length === 0) {
		return [];
	}

	const rows = await listSelect(deps.db)
		.where(inArray(entries.id, [...ids]))
		.orderBy(...listOrder);

	return listRecordsOf(deps.db, rows);
}

/**
 * How many transactions match `filter`. Joins `transactions` only when the
 * text search or the category or merchant filter needs its columns, so the
 * unfiltered count reads one index.
 */
async function countTransactions(deps: ServiceDeps, filter: TransactionFilter): Promise<number> {
	const where = filterCondition(filter, joinedTransferSide);

	if (where === null) {
		return 0;
	}

	const query = deps.db
		.select({ total: count() })
		.from(entries)
		.leftJoin(asOutflow, eq(asOutflow.outflowTransactionId, entries.id))
		.leftJoin(asInflow, eq(asInflow.inflowTransactionId, entries.id))
		.$dynamic();
	const rows = await (
		needsTransactionColumns(filter)
			? query.innerJoin(transactions, eq(transactions.entryId, entries.id))
			: query
	).where(where);

	return rows.reduce((total, row) => total + row.total, 0);
}

/** A page of transactions matching `filter`, as `listTransactionPage`, with their count. */
export async function listTransactions(
	deps: ServiceDeps,
	filter: TransactionFilter,
	page: { page: number; pageSize: number },
): Promise<{ items: TransactionListRecord[]; total: number }> {
	const items = await listTransactionPage(deps, filter, page);

	return { items, total: await countTransactions(deps, filter) };
}

/** The accounts of `TAX_ADVANTAGED_SUBTYPES`, whatever their state. */
async function taxAdvantagedAccountIds(deps: ServiceDeps): Promise<string[]> {
	const rows = await deps.db
		.select({ id: accounts.id })
		.from(accounts)
		.where(inArray(accounts.subtype, [...TAX_ADVANTAGED_SUBTYPES]));

	return rows.map((row) => row.id);
}

/** The sum of the amounts of the rows `condition` holds for, `0` when none does. */
function sumWhere(condition: SQL) {
	return sum(sql`case when ${condition} then ${entries.amount} else 0 end`).mapWith(Number);
}

/**
 * The signed sum, the income and expense sums and the count of the
 * transactions matching `filter`, one row per currency. Excluded transactions
 * count: the sums describe the rows the list shows, not a report. Income and
 * expenses are the direction filter's, so a transfer side counts in neither,
 * and leave out a tax-advantaged account's rows, as in Sure's
 * `Transaction::Search#totals`; the count and the signed sum keep them, since
 * the list pages on them. Joins `transactions` only for the text search and
 * the category and merchant filters, as the count does.
 */
export async function sumTransactions(
	deps: ServiceDeps,
	filter: TransactionFilter,
): Promise<
	{ currency: string; amount: MinorUnits; income: MinorUnits; expense: MinorUnits; count: number }[]
> {
	const where = filterCondition(filter, joinedTransferSide);

	if (where === null) {
		return [];
	}

	const sheltered = await taxAdvantagedAccountIds(deps);
	const reported = (direction: SQL) =>
		sheltered.length === 0 ? direction : both(direction, notInArray(entries.accountId, sheltered));
	const query = deps.db
		.select({
			currency: entries.currency,
			amount: sum(entries.amount).mapWith(Number),
			income: sumWhere(reported(joinedTransferSide.directions.income)),
			expense: sumWhere(reported(joinedTransferSide.directions.expense)),
			count: count(),
		})
		.from(entries)
		.leftJoin(asOutflow, eq(asOutflow.outflowTransactionId, entries.id))
		.leftJoin(asInflow, eq(asInflow.inflowTransactionId, entries.id))
		.$dynamic();
	const rows = await (
		needsTransactionColumns(filter)
			? query.innerJoin(transactions, eq(transactions.entryId, entries.id))
			: query
	)
		.where(where)
		.groupBy(entries.currency)
		.orderBy(entries.currency);

	return rows.map((row) => ({
		...toRecord(row),
		income: toMinorUnits(row.income),
		expense: toMinorUnits(row.expense),
	}));
}

/** The transactions of one label, one currency, one sign and one category. */
export type LabelTotal = {
	label: string;
	currency: string;
	/** `true` for money out: a label's refunds stay apart from its purchases. */
	outflow: boolean;
	categoryId: string | null;
	count: number;
	amount: MinorUnits;
	lastDate: IsoDate;
};

/**
 * The transactions matching `filter`, counted and summed per exact label,
 * currency, sign and category, as Sure's « Catégoriser » groups the lines it
 * offers. Excluded and pending rows count, as in the list. Labels that differ
 * by case or accents only are the caller's to merge: SQLite's `lower` folds
 * ASCII only.
 */
export async function sumTransactionsByLabel(
	deps: ServiceDeps,
	filter: TransactionFilter,
): Promise<LabelTotal[]> {
	const where = filterCondition(filter, joinedTransferSide);

	if (where === null) {
		return [];
	}

	const outflow = sql<number>`${entries.amount} < 0`;
	const rows = await deps.db
		.select({
			label: transactions.label,
			currency: entries.currency,
			outflow: outflow.mapWith(Boolean),
			categoryId: transactions.categoryId,
			count: count(),
			amount: sum(entries.amount).mapWith(Number),
			// Never null: a group holds one row at least.
			lastDate: sql<IsoDate>`max(${entries.date})`,
		})
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.leftJoin(asOutflow, eq(asOutflow.outflowTransactionId, entries.id))
		.leftJoin(asInflow, eq(asInflow.inflowTransactionId, entries.id))
		.where(where)
		.groupBy(transactions.label, entries.currency, outflow, transactions.categoryId);

	return rows.map(toRecord);
}

/**
 * The rows every cash-flow query counts (AD-9): transactions of `accountIds`
 * in the range, neither excluded nor pending, and no transfer side but the
 * outflow of a loan payment or an investment contribution. One definition, so
 * the month's breakdown and the budget's history never disagree; `null` when
 * nothing can match. No trade counts, as Sure's `trades_subquery_sql`.
 */
function countedInCashFlow(range: { from?: IsoDate; to: IsoDate; accountIds: readonly string[] }) {
	const where = filterCondition(range, joinedTransferSide);

	return where === null
		? null
		: and(
				where,
				not(joinedTransferSide.uncounted),
				eq(transactions.excluded, false),
				eq(transactions.pending, false),
			);
}

/**
 * The counted transactions of `accountIds` between `from` and `to`, both
 * inclusive, summed per category and per sign: `countsInCashFlow`'s SQL
 * twin, tied to it by a parity test. Each sign is a side of the gross view;
 * `netCashFlow` meets them again. The currency is the caller's to settle
 * through `accountIds`.
 */
export async function cashFlowByCategory(
	deps: ServiceDeps,
	range: { from: IsoDate; to: IsoDate; accountIds: readonly string[] },
): Promise<CashFlowRow[]> {
	const where = countedInCashFlow(range);

	if (where === null) {
		return [];
	}

	const rows = await deps.db
		.select({
			categoryId: transactions.categoryId,
			amount: sum(entries.amount).mapWith(Number),
		})
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.leftJoin(asOutflow, eq(asOutflow.outflowTransactionId, entries.id))
		.leftJoin(asInflow, eq(asInflow.inflowTransactionId, entries.id))
		.where(where)
		.groupBy(transactions.categoryId, sql`${entries.amount} > 0`);

	return rows.map(toRecord);
}

/** `cashFlowByCategory`'s rows, each group also keyed by `key`, an expression of the entry's date. */
async function cashFlowKeyed(
	deps: ServiceDeps,
	range: { from?: IsoDate; to: IsoDate; accountIds: readonly string[] },
	key: SQL<string>,
): Promise<(CashFlowRow & { key: string })[]> {
	const where = countedInCashFlow(range);

	if (where === null) {
		return [];
	}

	const rows = await deps.db
		.select({
			key,
			categoryId: transactions.categoryId,
			amount: sum(entries.amount).mapWith(Number),
		})
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.leftJoin(asOutflow, eq(asOutflow.outflowTransactionId, entries.id))
		.leftJoin(asInflow, eq(asInflow.inflowTransactionId, entries.id))
		.where(where)
		.groupBy(key, transactions.categoryId, sql`${entries.amount} > 0`);

	return rows.map(toRecord);
}

/**
 * `cashFlowByCategory`'s rows over every month up to `to`, inclusive, each
 * group also keyed by its calendar month: the same counted rows, so a month's
 * rows here sum to that month's rows there, which a parity test checks. The
 * budget's suggestions read it, one query for the whole history.
 */
export async function cashFlowByMonth(
	deps: ServiceDeps,
	range: { to: IsoDate; accountIds: readonly string[] },
): Promise<(CashFlowRow & { month: IsoMonth })[]> {
	const rows = await cashFlowKeyed(deps, range, sql<IsoMonth>`substr(${entries.date}, 1, 7)`);

	return rows.map(({ key, ...row }) => ({ ...row, month: key }));
}

/**
 * `cashFlowByCategory`'s rows from `from`, or the first day, to `to`, each
 * group also keyed by its day: one read from which the assistant's income
 * statement sums any period, the one before it, its months and the
 * history's monthly medians, where a read per figure would scan the history
 * again for each.
 */
export async function cashFlowByDay(
	deps: ServiceDeps,
	range: { from?: IsoDate; to: IsoDate; accountIds: readonly string[] },
): Promise<(CashFlowRow & { date: IsoDate })[]> {
	const rows = await cashFlowKeyed(deps, range, sql<IsoDate>`${entries.date}`);

	return rows.map(({ key, ...row }) => ({ ...row, date: key }));
}

/**
 * The date of the oldest entry of any kind on any account, an opening anchor
 * included; `null` when the ledger holds none. Budgets reach back to its month.
 */
export async function oldestEntryDate(deps: ServiceDeps): Promise<IsoDate | null> {
	const [oldest] = await deps.db
		.select({ date: entries.date })
		.from(entries)
		.orderBy(entries.date)
		.limit(1);

	return oldest?.date ?? null;
}
