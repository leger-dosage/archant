import type { CashFlowRow } from "../../domain/cash-flow.ts";
import type { IsoDate, IsoMonth } from "../../domain/dates.ts";
import type { ServiceDeps } from "../deps.ts";
import type { TransactionFilter } from "./filter.ts";
import type { Transaction, TransferColumns } from "./shared.ts";
import type { SQL } from "drizzle-orm";

import { and, count, desc, eq, inArray, sql, sum } from "drizzle-orm";

import type { AccountType } from "@archant/data/account-types";
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
import type { TransferKind } from "@archant/data/transfer-kinds";

import {
	correlatedTransferSide,
	filterCondition,
	joinedTransferSide,
	needsTransactionColumns,
} from "./filter.ts";
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
import { candidatePairs } from "./transfers.ts";

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
	 * In no transfer, with at least `SUGGESTION_THRESHOLD` candidates: automatic
	 * matching left it for the user to pick.
	 */
	transferSuggested: boolean;
	/**
	 * Created by an import or a sync that found two entries equally near it
	 * (AD-7), until the user merges or dismisses it.
	 */
	possibleDuplicate: boolean;
};

/**
 * A transaction's transfer as its row shows it. Which side it is follows from
 * its amount: the outflow is the negative one.
 */
type TransferLink = {
	id: string;
	kind: TransferKind;
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
};

function toRecord<Row extends { amount: number }>(row: Row): Row & { amount: MinorUnits } {
	return { ...row, amount: toMinorUnits(row.amount) };
}

/**
 * How many candidates make a suggestion. Two, as the epic says: a pair unlinked
 * with « Dissocier » has one candidate, and flagging it would undo the unlink.
 */
const SUGGESTION_THRESHOLD = 2;

/**
 * The rows of `entryIds` with at least `SUGGESTION_THRESHOLD` candidates, by
 * the search the picker and step 6 use, `isTransferCandidate` included, so the
 * flag never disagrees with them. Read after the page query, for its rows in
 * no transfer only: a subquery in the page's select would run for every row
 * the filter keeps whenever the sort is not index-covered.
 */
async function suggestedAmong(
	db: Pick<Transaction, "select">,
	entryIds: readonly string[],
): Promise<Set<string>> {
	const counts = new Map<string, number>();

	for (const { source } of await candidatePairs(db, entryIds)) {
		counts.set(source.id, (counts.get(source.id) ?? 0) + 1);
	}

	return new Set(
		[...counts].filter(([, total]) => total >= SUGGESTION_THRESHOLD).map(([id]) => id),
	);
}

/** The ids of `rows` in no transfer, the only ones a suggestion is read for. */
const unmatchedIds = (rows: readonly { id: string; transferId: string | null }[]) =>
	rows.filter((row) => row.transferId === null).map((row) => row.id);

/** Folds the transfer columns of a row into its `transfer`. */
function withTransferLink<Row extends TransferColumns>(
	row: Row,
): Omit<Row, keyof TransferColumns> & { transfer: TransferLink | null } {
	const { transferId, transferKind, counterpartAccountId, counterpartAccountName, ...rest } = row;

	return {
		...rest,
		transfer:
			transferId === null ||
			transferKind === null ||
			counterpartAccountId === null ||
			counterpartAccountName === null
				? null
				: { id: transferId, kind: transferKind, counterpartAccountId, counterpartAccountName },
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

	const suggested = await suggestedAmong(deps.db, unmatchedIds([row]));

	return {
		...withTransferLink(toRecord(row)),
		tagIds: await tagIdsOf(deps.db, entryId),
		transferSuggested: suggested.has(entryId),
	};
}

/**
 * A page of transactions matching `filter`, most recent first (AD-15), each
 * with its account's name, and no count: the cross-account list asks for its
 * totals apart, once per filter rather than once per page.
 */
export async function listTransactionPage(
	deps: ServiceDeps,
	filter: TransactionFilter,
	page: { page: number; pageSize: number },
): Promise<TransactionListRecord[]> {
	const where = filterCondition(filter, joinedTransferSide);

	if (where === null) {
		return [];
	}

	const rows = await deps.db
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
		.where(where)
		// A pending row sits at the top of its day: the bank has not settled it yet.
		.orderBy(
			desc(entries.date),
			desc(transactions.pending),
			desc(entries.createdAt),
			desc(entries.id),
		)
		.limit(page.pageSize)
		.offset((page.page - 1) * page.pageSize);

	const tagsOf = await tagIdsByEntry(
		deps.db,
		rows.map((row) => row.id),
	);
	const suggested = await suggestedAmong(deps.db, unmatchedIds(rows));

	return rows.map((row) => ({
		...withTransferLink(toRecord(row)),
		tagIds: tagsOf.get(row.id) ?? [],
		transferSuggested: suggested.has(row.id),
	}));
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

/** The sum of the amounts of the rows `condition` holds for, `0` when none does. */
function sumWhere(condition: SQL) {
	return sum(sql`case when ${condition} then ${entries.amount} else 0 end`).mapWith(Number);
}

/**
 * The signed sum, the income and expense sums and the count of the
 * transactions matching `filter`, one row per currency. Excluded transactions
 * count: the sums describe the rows the list shows, not a report. Income and
 * expenses are the direction filter's, so a transfer side counts in neither,
 * as in Sure's `Transaction::Search#totals`. Joins `transactions` only for the
 * text search and the category and merchant filters, as the count does.
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

	const query = deps.db
		.select({
			currency: entries.currency,
			amount: sum(entries.amount).mapWith(Number),
			income: sumWhere(joinedTransferSide.directions.income),
			expense: sumWhere(joinedTransferSide.directions.expense),
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
 * The rows every cash-flow query counts (AD-9): income and expense sides of
 * `accountIds` in the range, neither excluded nor pending. One definition, so
 * the month's breakdown and the budget's history never disagree; `null` when
 * nothing can match.
 */
function countedInCashFlow(range: { from?: IsoDate; to: IsoDate; accountIds: readonly string[] }) {
	const where = filterCondition(
		{ ...range, direction: ["income", "expense"] },
		correlatedTransferSide,
	);

	return where === null
		? null
		: and(where, eq(transactions.excluded, false), eq(transactions.pending, false));
}

/**
 * The counted transactions of `accountIds` between `from` and `to`, both
 * inclusive, summed per category and per sign: `countsInCashFlow`'s SQL
 * twin, tied to it by a parity test. Uncategorised rows keep their two signs
 * apart, since « Sans catégorie » splits into income and expenses; a
 * category's two signs meet again in `cashFlowBreakdown`. The currency is the
 * caller's to settle through `accountIds`.
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
		.where(where)
		.groupBy(transactions.categoryId, sql`${entries.amount} > 0`);

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
	const where = countedInCashFlow(range);

	if (where === null) {
		return [];
	}

	const month = sql<IsoMonth>`substr(${entries.date}, 1, 7)`;
	const rows = await deps.db
		.select({
			month,
			categoryId: transactions.categoryId,
			amount: sum(entries.amount).mapWith(Number),
		})
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.where(where)
		.groupBy(month, transactions.categoryId, sql`${entries.amount} > 0`);

	return rows.map(toRecord);
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
