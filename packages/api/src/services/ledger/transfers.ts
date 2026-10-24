import type { IsoDate } from "../../domain/dates.ts";
import type { ExpectingSide, TransferSide } from "../../domain/transfer-matching.ts";
import type { DefaultCategory } from "../default-categories.ts";
import type { ServiceDeps } from "../deps.ts";
import type { Origin, Transaction } from "./shared.ts";
import type { SQL, SQLWrapper } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

import { and, between, eq, inArray, isNull, lt, ne, not, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import type { AccountType } from "@archant/data/account-types";
import { classificationOf } from "@archant/data/account-types";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import type { CategoryOrigin } from "@archant/data/schema/categories";
import { categories } from "@archant/data/schema/categories";
import { entries } from "@archant/data/schema/entries";
import { rejectedTransfers } from "@archant/data/schema/rejected-transfers";
import { taggings } from "@archant/data/schema/taggings";
import { transactions } from "@archant/data/schema/transactions";
import { transferFees } from "@archant/data/schema/transfer-fees";
import { transfers } from "@archant/data/schema/transfers";
import type { TransferStatus } from "@archant/data/transfer-kinds";
import type { Transfer } from "@archant/data/types";

import { daysBetween, today } from "../../domain/dates.ts";
import { isTooFarAhead } from "../../domain/statement.ts";
import {
	HAND_TRANSFER_WINDOW_DAYS,
	TRANSFER_WINDOW_DAYS,
	greedyMatches,
	isTransferCandidate,
	narrowToExpected,
	transferKindOf,
} from "../../domain/transfer-matching.ts";
import { AppError } from "../../lib/errors.ts";
import { INVESTMENT_CONTRIBUTIONS_CATEGORY } from "../default-categories.ts";
import { accountWithOpeningDate, recomputeBalances } from "./balances.ts";
import { categoryOriginOf, tagsExist } from "./patch.ts";
import {
	KEYS_PER_LOOKUP,
	ROWS_PER_INSERT,
	deleteTransactionRows,
	inAnyTransfer,
	inSequence,
	inTransferSql,
	invalidField,
	lockedBy,
	oneByOne,
} from "./shared.ts";

/** A transaction that can be the other side of a transfer, as the picker lists it. */
export type TransferCandidate = {
	id: string;
	date: IsoDate;
	label: string;
	amount: MinorUnits;
	currency: string;
	accountId: string;
	accountName: string;
	/** What the inflow of a loan payment or a contribution paired with it shows, as the list's `counterpartCategoryId`. */
	categoryId: string | null;
};

/** Whether the user refused `a` and `b` as one transfer, whichever side each was. */
function isRejectedPair(a: SQLWrapper, b: SQLWrapper): SQL {
	return sql`exists (select 1 from ${rejectedTransfers} where (${rejectedTransfers.outflowTransactionId} = ${a} and ${rejectedTransfers.inflowTransactionId} = ${b}) or (${rejectedTransfers.outflowTransactionId} = ${b} and ${rejectedTransfers.inflowTransactionId} = ${a}))`;
}

/** The columns of an `entries` row, or of an alias of it, the prefilter reads. */
type SideRef = Record<"id" | "accountId" | "date" | "amount" | "currency", SQLiteColumn>;

/** How a search pairs: how many days apart, and whether a pair the owner rejected may come back. */
type Search = { windowDays: number; rejected: "allowed" | "refused" };

/** The matcher's proposals, as Sure's `auto_match_transfers!`. */
const PROPOSAL: Search = { windowDays: TRANSFER_WINDOW_DAYS, rejected: "refused" };

/**
 * A pair by hand, as Sure's `transfer_match_candidates(date_window: 30)`,
 * whose `include_rejected` defaults to true: the owner may pair by hand what
 * they told the matcher never to propose.
 */
const BY_HAND: Search = { windowDays: HAND_TRANSFER_WINDOW_DAYS, rejected: "allowed" };

/**
 * The SQL prefilter of `isTransferCandidate`: `candidate` is a transaction
 * with the opposite, non-zero amount of `source`, in another account of its
 * currency, within the window, neither is in a transfer, and, for a
 * proposal, the user never rejected the pair. The query adds the source's
 * kind and `matchableSide` on both sides, which reads the transaction and
 * account rows this condition does not join. One search serves the picker,
 * `matchTransfer`'s re-check, step 6 of `ingest` and
 * `applyRulePlanToHistory`, so none of them can offer a pair another refuses.
 */
function candidateOf(
	source: SideRef,
	candidate: SideRef & Record<"kind", SQLiteColumn>,
	search: Search,
): SQL | undefined {
	// SQLite date modifiers, so the window can follow a column as well as a value.
	const before = `-${search.windowDays} days`;
	const after = `+${search.windowDays} days`;

	return and(
		eq(candidate.kind, "transaction"),
		ne(source.amount, 0),
		eq(candidate.amount, sql`-${source.amount}`),
		ne(candidate.accountId, source.accountId),
		eq(candidate.currency, source.currency),
		between(
			candidate.date,
			sql`date(${source.date}, ${before})`,
			sql`date(${source.date}, ${after})`,
		),
		not(inTransferSql(source.id)),
		not(inTransferSql(candidate.id)),
		search.rejected === "refused" ? not(isRejectedPair(source.id, candidate.id)) : undefined,
	);
}

/**
 * The SQL of `isTransferCandidate`'s `excluded` and `accountActive`: neither
 * an excluded row nor a row of a deactivated account is ever a side, as
 * Sure's `Family::AutoTransferMatchable`. A split line is a side as any
 * transaction; its parent is excluded (AD-20).
 */
function matchableSide(
	transaction: Record<"excluded", SQLiteColumn>,
	account: Record<"active", SQLiteColumn>,
): SQL | undefined {
	return and(eq(transaction.excluded, false), eq(account.active, true));
}

const sideColumns = {
	id: entries.id,
	kind: entries.kind,
	accountId: entries.accountId,
	accountType: accounts.type,
	date: entries.date,
	amount: entries.amount,
	currency: entries.currency,
	inTransfer: inAnyTransfer.mapWith(Boolean),
	excluded: transactions.excluded,
	accountActive: accounts.active,
};

/** One transaction as the matching rule reads it, `undefined` when the id names none. */
async function transferSide(db: Pick<Transaction, "select">, entryId: string) {
	const row = await db
		.select(sideColumns)
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.innerJoin(accounts, eq(accounts.id, entries.accountId))
		.where(eq(entries.id, entryId))
		.get();

	return row === undefined ? undefined : { ...row, amount: toMinorUnits(row.amount) };
}

function asSide(row: Omit<TransferSide, "amount"> & { amount: number }): TransferSide {
	return { ...row, amount: toMinorUnits(row.amount) };
}

const sourceEntry = alias(entries, "source_entry");
const sourceAccount = alias(accounts, "source_account");
const sourceTransaction = alias(transactions, "source_transaction");

/** A side of a candidate pair, with what a transfer's direction and kind need. */
type PairSide = { id: string; amount: number; accountType: AccountType };

/**
 * Every candidate pair whose source `where` keeps, the candidate's label and
 * account name with it. Cross joins, conditions in `where`: SQLite keeps a
 * cross join's tables in the order written, so each source is read once and
 * its candidates looked up by `entries_kind_amount_date`. As inner joins,
 * the planner looped over the few accounts first and looked every source up
 * once per account, ten times the work of an import.
 */
function candidatePairQuery(
	db: Pick<Transaction, "select">,
	sources: SQL | undefined,
	search: Search,
) {
	return db
		.select({
			source: {
				id: sourceEntry.id,
				kind: sourceEntry.kind,
				accountId: sourceEntry.accountId,
				accountType: sourceAccount.type,
				date: sourceEntry.date,
				amount: sourceEntry.amount,
				currency: sourceEntry.currency,
				inTransfer: inTransferSql(sourceEntry.id).mapWith(Boolean),
				excluded: sourceTransaction.excluded,
				accountActive: sourceAccount.active,
				expectedAccountId: sourceTransaction.expectedTransferAccountId,
			},
			candidate: {
				...sideColumns,
				label: transactions.label,
				accountName: accounts.name,
				categoryId: transactions.categoryId,
				expectedAccountId: transactions.expectedTransferAccountId,
			},
		})
		.from(sourceEntry)
		.crossJoin(sourceAccount)
		.crossJoin(sourceTransaction)
		.crossJoin(entries)
		.crossJoin(transactions)
		.crossJoin(accounts)
		.where(
			and(
				sources,
				eq(sourceAccount.id, sourceEntry.accountId),
				eq(sourceTransaction.entryId, sourceEntry.id),
				candidateOf(sourceEntry, entries, search),
				eq(transactions.entryId, entries.id),
				eq(accounts.id, entries.accountId),
				matchableSide(sourceTransaction, sourceAccount),
				matchableSide(transactions, accounts),
			),
		)
		.orderBy(entries.date, entries.createdAt, entries.id);
}

type CandidatePair = Awaited<ReturnType<typeof candidatePairQuery>>[number];

/** The rows `isTransferCandidate` accepts within `search`'s window: SQL narrows, the rule has the last word. */
const accepted = (rows: readonly CandidatePair[], search: Search) =>
	rows.filter(({ source, candidate }) =>
		isTransferCandidate(asSide(source), asSide(candidate), search.windowDays),
	);

/**
 * The candidates of `entryId` a pair by hand may take, ordered by date, then
 * the older entry; `counterpartId` keeps that one candidate only.
 */
async function handCandidates(
	db: Pick<Transaction, "select">,
	entryId: string,
	counterpartId?: string,
): Promise<CandidatePair[]> {
	const rows = await candidatePairQuery(
		db,
		and(
			eq(sourceEntry.id, entryId),
			// `+` keeps SQLite from reading the source through an index on `kind`.
			// Sampled by `analysis_limit`, `kind` looks as selective as a key, and at
			// 100,000 transactions the planner scanned every transaction instead of
			// looking the source up by its id.
			eq(sql`+${sourceEntry.kind}`, "transaction"),
			counterpartId === undefined ? undefined : eq(entries.id, counterpartId),
		),
		BY_HAND,
	);

	return accepted(rows, BY_HAND);
}

/**
 * A transfer between `a` and `b`, the negative side as the outflow, its kind
 * from both accounts' types.
 */
function transferBetween(a: PairSide, b: PairSide, status: TransferStatus, now: number): Transfer {
	const [outflow, inflow] = a.amount < 0 ? [a, b] : [b, a];

	return {
		id: crypto.randomUUID(),
		outflowTransactionId: outflow.id,
		inflowTransactionId: inflow.id,
		kind: transferKindOf(inflow.accountType, outflow.accountType),
		status,
		idempotencyKey: null,
		notes: null,
		createdAt: now,
	};
}

/**
 * Every candidate pair of the household the matcher weighs, one row per pair,
 * the outflow as its source: Sure's `transfer_match_candidates` with
 * `include_rejected: false`. Each unmatched outflow is read from
 * `entries_kind_amount_date` by its sign, and its candidates from the same
 * index by the opposite amount and the window.
 */
export function proposalCandidateQuery(db: Pick<Transaction, "select">) {
	return candidatePairQuery(
		db,
		and(eq(sourceEntry.kind, "transaction"), lt(sourceEntry.amount, 0)),
		PROPOSAL,
	);
}

/**
 * Clears the one-time flag of each side a transfer write touches, as Sure's
 * `Family::AutoTransferMatchable` and `Transfer::Creator` overwrite both
 * kinds and `Transfer#destroy!` resets them to `standard`: a side just
 * paired is not one-time, and an undone one counts again as the plain
 * transaction it was.
 */
export async function clearOneTime(tx: Pick<Transaction, "update">, ids: readonly string[]) {
	await inSequence(ids, KEYS_PER_LOOKUP, (chunk) =>
		tx
			.update(transactions)
			.set({ oneTime: false })
			.where(and(inArray(transactions.entryId, chunk), eq(transactions.oneTime, true))),
	);
}

/** Both sides of `transfer`, as `clearOneTime` takes them. */
export const sidesOf = (transfer: TransferSides) => [
	transfer.outflowTransactionId,
	transfer.inflowTransactionId,
];

/** The side ranking reads of a pair: its id, its account and the account a rule expects. */
const expecting = (side: { id: string; accountId: string; expectedAccountId: string | null }) => ({
	id: side.id,
	accountId: side.accountId,
	expectedAccountId: side.expectedAccountId,
});

/**
 * Step 6 of `ingest`, the end of `applyRulePlanToHistory` and of each split
 * write in `splits.ts`: proposes a `pending` transfer for the pairs Sure's
 * `auto_match_transfers!` would make, over every unmatched transaction of
 * the household, so a line left free before is weighed again (AD-11). A
 * rule's expected counterpart account narrows each line's candidates first,
 * from both sides, through `narrowToExpected`; `greedyMatches` then takes
 * the closest pairs. Every candidate is read before the first transfer is
 * written, so the result depends neither on line order nor on which account
 * synced first. No balance, lock or tag moves; a contribution's outflow
 * without a category takes « Contributions aux investissements », as Sure's.
 */
export async function matchTransfers(
	tx: Pick<Transaction, "select" | "insert" | "update">,
	now: number,
): Promise<void> {
	const rows = accepted(await proposalCandidateQuery(tx), PROPOSAL);
	// Each line with what it sees of the other side of each of its pairs.
	const lines = new Map<string, { side: ExpectingSide; candidates: ExpectingSide[] }>();
	const meet = (side: ExpectingSide, other: ExpectingSide) => {
		const line = lines.get(side.id) ?? { side, candidates: [] };

		line.candidates.push(other);
		lines.set(side.id, line);
	};

	for (const { source, candidate } of rows) {
		meet(expecting(source), expecting(candidate));
		meet(expecting(candidate), expecting(source));
	}

	const kept = new Map(
		[...lines].map(([id, line]) => [id, new Set(narrowToExpected(line.side, line.candidates))]),
	);
	const links = greedyMatches(
		rows
			.filter(
				({ source, candidate }) =>
					kept.get(source.id)?.has(candidate.id) === true &&
					kept.get(candidate.id)?.has(source.id) === true,
			)
			.map((row) => ({
				outflowId: row.source.id,
				inflowId: row.candidate.id,
				days: Math.abs(daysBetween(row.source.date, row.candidate.date)),
				row,
			})),
	).map(({ row }) => transferBetween(row.source, row.candidate, "pending", now));

	await inSequence(links, ROWS_PER_INSERT, (chunk) => tx.insert(transfers).values(chunk));
	await clearOneTime(tx, links.flatMap(sidesOf));
	await categoriseContributions(tx, links, "rule", now);
}

/**
 * The transactions `entryId` can be paired with by hand, within
 * `HAND_TRANSFER_WINDOW_DAYS`, closest date first, then the earlier, then
 * the older entry, a rejected pair included, as Sure's picker. Throws
 * `NOT_FOUND` for an unknown transaction; a transaction already in a
 * transfer has no candidate.
 */
export async function transferCandidates(
	deps: ServiceDeps,
	entryId: string,
): Promise<TransferCandidate[]> {
	const source = await transferSide(deps.db, entryId);

	if (source === undefined) {
		throw new AppError("NOT_FOUND", "No transaction has this id.");
	}

	const rows = await handCandidates(deps.db, entryId);

	return (
		rows
			.map(({ candidate }) => ({
				candidate,
				distance: Math.abs(daysBetween(source.date, candidate.date)),
			}))
			// Stable, so rows equally far keep the query's order.
			.toSorted((a, b) => a.distance - b.distance)
			.map(({ candidate }) => ({
				id: candidate.id,
				date: candidate.date,
				label: candidate.label,
				amount: toMinorUnits(candidate.amount),
				currency: candidate.currency,
				accountId: candidate.accountId,
				accountName: candidate.accountName,
				categoryId: candidate.categoryId,
			}))
	);
}

/**
 * Links `entryId` and `counterpartId` as one `confirmed` transfer, the
 * negative side as the outflow, its kind from the inflow account's type: the
 * owner chose it, so there is nothing left to confirm. The candidate search
 * runs again inside the write, so a concurrent match cannot put a
 * transaction in two transfers. A pair the owner once rejected may be paired
 * by hand. No balance, lock or tag moves: the two rows stay what they were,
 * only their direction changes, and a contribution's outflow without a
 * category takes « Contributions aux investissements », as Sure's
 * `TransferMatchesController#create`. Throws `NOT_FOUND`
 * for an unknown `entryId`, `VALIDATION_ERROR` on `counterpartId` when it is
 * no candidate, unknown, more than 30 days away, already matched, excluded
 * or on a deactivated account included.
 */
export async function matchTransfer(
	deps: ServiceDeps,
	entryId: string,
	counterpartId: string,
	options: { origin: Origin },
): Promise<Transfer> {
	return deps.db.transaction(
		async (tx): Promise<Transfer> => {
			if ((await transferSide(tx, entryId)) === undefined) {
				throw new AppError("NOT_FOUND", "No transaction has this id.");
			}

			const [pair] = await handCandidates(tx, entryId, counterpartId);

			if (pair === undefined) {
				throw invalidField("counterpartId", "not_a_candidate");
			}

			const now = Date.now();
			const transfer = transferBetween(pair.source, pair.candidate, "confirmed", now);

			await tx.insert(transfers).values(transfer);
			await clearOneTime(tx, sidesOf(transfer));
			await categoriseContributions(tx, [transfer], categoryOriginOf(options.origin), now);

			return transfer;
		},
		{ behavior: "immediate" },
	);
}

/**
 * Confirms a transfer the matcher proposed, as Sure's `Transfer#confirm!`:
 * only its status changes, and confirming a confirmed transfer changes
 * nothing. Throws `NOT_FOUND` for an unknown id.
 */
export async function confirmTransfer(
	deps: ServiceDeps,
	transferId: string,
	_options: { origin: Origin },
): Promise<TransferSides> {
	return deps.db.transaction(
		async (tx) => {
			const [confirmed] = await tx
				.update(transfers)
				.set({ status: "confirmed" })
				.where(eq(transfers.id, transferId))
				.returning(sidesColumns);

			if (confirmed === undefined) {
				throw new AppError("NOT_FOUND", "No transfer has this id.");
			}

			return confirmed;
		},
		{ behavior: "immediate" },
	);
}

/** The two sides a transfer joined, as an unpair gives them back. */
export type TransferSides = Pick<Transfer, "outflowTransactionId" | "inflowTransactionId">;

/** A transfer's status, `undefined` when no transfer has this id. Reads only. */
export async function transferStatusOf(
	deps: ServiceDeps,
	transferId: string,
): Promise<Transfer["status"] | undefined> {
	const row = await deps.db
		.select({ status: transfers.status })
		.from(transfers)
		.where(eq(transfers.id, transferId))
		.get();

	return row?.status;
}

const sidesColumns = {
	outflowTransactionId: transfers.outflowTransactionId,
	inflowTransactionId: transfers.inflowTransactionId,
};

/**
 * Deletes a transfer, both sides becoming standard transactions again, their
 * category, locks and tags as they were, and returns the two sides. Throws
 * `NOT_FOUND` for an unknown id.
 */
export async function unmatchTransfer(
	deps: ServiceDeps,
	transferId: string,
	_options: { origin: Origin },
): Promise<TransferSides> {
	return deps.db.transaction(
		async (tx) => {
			const deleted = await deleteTransferRow(tx, transferId);

			if (deleted === undefined) {
				throw new AppError("NOT_FOUND", "No transfer has this id.");
			}

			await clearOneTime(tx, sidesOf(deleted));
			await deleteFees(tx, deleted.feeLines, deps.timeZone);

			return {
				outflowTransactionId: deleted.outflowTransactionId,
				inflowTransactionId: deleted.inflowTransactionId,
			};
		},
		{ behavior: "immediate" },
	);
}

/**
 * Undoes a transfer, as `unmatchTransfer`, and records its pair so that the
 * matcher never proposes it again, as Sure's `Transfer#reject!`; the owner
 * may still pair it by hand. There is no way back: the pair stays refused
 * until one side is deleted. Returns the two
 * sides; throws `NOT_FOUND` for an unknown id.
 */
export async function rejectTransfer(
	deps: ServiceDeps,
	transferId: string,
	_options: { origin: Origin },
): Promise<TransferSides> {
	return deps.db.transaction(
		async (tx) => {
			const deleted = await deleteTransferRow(tx, transferId);

			if (deleted === undefined) {
				throw new AppError("NOT_FOUND", "No transfer has this id.");
			}

			const sides = {
				outflowTransactionId: deleted.outflowTransactionId,
				inflowTransactionId: deleted.inflowTransactionId,
			};

			await clearOneTime(tx, sidesOf(sides));
			await deleteFees(tx, deleted.feeLines, deps.timeZone);
			await tx.insert(rejectedTransfers).values({
				id: crypto.randomUUID(),
				...sides,
				createdAt: Date.now(),
			});

			return sides;
		},
		{ behavior: "immediate" },
	);
}

/** A fee line of a transfer, with what deleting it must recompute. */
type FeeLine = { id: string; accountId: string; date: IsoDate };

/**
 * Deletes a transfer row and returns its sides with its fee lines, read
 * before the row goes, since their links go with it.
 */
async function deleteTransferRow(tx: Transaction, transferId: string) {
	const feeLines = await tx
		.select({ id: entries.id, accountId: entries.accountId, date: entries.date })
		.from(transferFees)
		.innerJoin(entries, eq(entries.id, transferFees.transactionId))
		.where(eq(transferFees.transferId, transferId));
	const [deleted] = await tx
		.delete(transfers)
		.where(eq(transfers.id, transferId))
		.returning(sidesColumns);

	return deleted === undefined ? undefined : { ...deleted, feeLines };
}

/**
 * Deletes a transfer's fee lines, as Sure's `has_many :fee_transactions,
 * dependent: :destroy`, and recomputes each account they were on.
 */
async function deleteFees(tx: Transaction, feeLines: readonly FeeLine[], timeZone: string) {
	if (feeLines.length === 0) {
		return;
	}

	await deleteTransactionRows(
		tx,
		feeLines.map((fee) => fee.id),
	);
	await oneByOne(feeLines, async (fee) =>
		recomputeBalances(tx, await accountWithOpeningDate(tx, fee.accountId), fee.date, timeZone),
	);
}

/** A transfer between two of the household's accounts, as the form gives it, in minor units. */
export type TransferBetween = {
	fromAccountId: string;
	toAccountId: string;
	date: IsoDate;
	amount: MinorUnits;
	sourceFee: MinorUnits;
	destinationFee: MinorUnits;
	tagIds: readonly string[];
	idempotencyKey?: string | undefined;
};

/** A transfer created, or the one a double submit's key already created. */
export type CreatedTransfer = { transfer: Transfer; created: boolean };

/** Sure's `models.category.defaults.fees`, the category of every transfer fee. */
const FEES_CATEGORY: DefaultCategory = { name: "Frais", color: "#6b7280", icon: "receipt" };

/**
 * The category named as `category`, case aside, else one created with its
 * colour and icon, as Sure's `find_or_create_by!`.
 */
async function categoryIdFor(
	tx: Pick<Transaction, "select" | "insert">,
	category: DefaultCategory,
	now: number,
): Promise<string> {
	const found = await tx
		.select({ id: categories.id })
		.from(categories)
		.where(eq(sql`lower(${categories.name})`, category.name.toLowerCase()))
		.get();

	if (found !== undefined) {
		return found.id;
	}

	const id = crypto.randomUUID();
	await tx
		.insert(categories)
		.values({ id, ...category, parentId: null, createdAt: now, updatedAt: now });

	return id;
}

/** Which of `ids` have no category. */
const uncategorised = (ids: readonly string[]) =>
	and(inArray(transactions.entryId, ids), isNull(transactions.categoryId));

/**
 * Puts the outflow of each investment contribution among `written` in
 * « Contributions aux investissements » when it has no category, as Sure's
 * `Transfer::Creator`, `auto_match_transfers!` and `TransferMatchesController`;
 * a category already there stays. The category is found or created only when
 * an outflow needs it, so one the owner deleted comes back with the next
 * contribution, as Sure's `Family#investment_contributions_category`. No lock,
 * as Sure's `update!`.
 */
async function categoriseContributions(
	tx: Pick<Transaction, "select" | "insert" | "update">,
	written: readonly Transfer[],
	origin: CategoryOrigin,
	now: number,
): Promise<void> {
	const outflows = written
		.filter((transfer) => transfer.kind === "investment_contribution")
		.map((transfer) => transfer.outflowTransactionId);
	let categoryId: string | undefined;

	await inSequence(outflows, KEYS_PER_LOOKUP, async (chunk) => {
		const needed = await tx
			.select({ id: transactions.entryId })
			.from(transactions)
			.where(uncategorised(chunk))
			.get();

		if (needed === undefined) {
			return;
		}

		categoryId ??= await categoryIdFor(tx, INVESTMENT_CONTRIBUTIONS_CATEGORY, now);
		await tx
			.update(transactions)
			.set({ categoryId, categoryOrigin: origin })
			.where(uncategorised(chunk));
	});
}

/** An account a transfer names, or `VALIDATION_ERROR` on `path`. */
async function transferAccount(tx: Transaction, id: string, path: string) {
	const row = await tx
		.select({
			id: accounts.id,
			name: accounts.name,
			type: accounts.type,
			currency: accounts.currency,
			active: accounts.active,
		})
		.from(accounts)
		.where(eq(accounts.id, id))
		.get();

	// The form lists active accounts only, as Sure's `set_accounts`.
	if (row === undefined || !row.active) {
		throw invalidField(path);
	}

	return row;
}

/**
 * The transfer `key` created, `undefined` for none, with what Sure's
 * `matches_request?` compares: both accounts, the date, the amount and each fee.
 */
async function transferOfKey(tx: Transaction, key: string) {
	const outflow = alias(entries, "key_outflow");
	const inflow = alias(entries, "key_inflow");
	const transfer = await tx
		.select({ transfer: transfers, outflow, inflow })
		.from(transfers)
		.innerJoin(outflow, eq(outflow.id, transfers.outflowTransactionId))
		.innerJoin(inflow, eq(inflow.id, transfers.inflowTransactionId))
		.where(eq(transfers.idempotencyKey, key))
		.get();

	if (transfer === undefined) {
		return undefined;
	}

	const fees = await tx
		.select({ accountId: entries.accountId, amount: entries.amount })
		.from(transferFees)
		.innerJoin(entries, eq(entries.id, transferFees.transactionId))
		.where(eq(transferFees.transferId, transfer.transfer.id));
	const feeOn = (accountId: string) =>
		fees.filter((fee) => fee.accountId === accountId).reduce((total, fee) => total - fee.amount, 0);

	return {
		transfer: transfer.transfer,
		fromAccountId: transfer.outflow.accountId,
		toAccountId: transfer.inflow.accountId,
		date: transfer.outflow.date,
		amount: -transfer.outflow.amount,
		sourceFee: feeOn(transfer.outflow.accountId),
		destinationFee: feeOn(transfer.inflow.accountId),
	};
}

/**
 * Creates a transfer between two of the household's accounts, as Sure's
 * `Transfer::Creator`, in one transaction: the outflow on `fromAccountId`
 * named « Virement vers » the destination, or « Paiement vers » for a
 * liability, the inflow on `toAccountId` named « Virement depuis » or
 * « Paiement depuis » the source, both locked as a line typed by hand and
 * tagged with `tagIds`; the transfer `confirmed`, its kind from both
 * accounts' types, a contribution's outflow in « Contributions aux
 * investissements »; each fee above zero a standard line on its account in
 * « Frais », linked to the transfer. A key a transfer already holds returns
 * that transfer when every field matches, else throws `TRANSFER_FORM_STALE`.
 * Throws `VALIDATION_ERROR` for an unknown account, the same account twice,
 * two currencies (AD-6) or an unknown tag.
 */
export async function createTransferBetween(
	deps: ServiceDeps,
	input: TransferBetween,
	options: { origin: Origin },
): Promise<CreatedTransfer> {
	return deps.db.transaction(
		async (tx): Promise<CreatedTransfer> => {
			if (input.idempotencyKey !== undefined) {
				const existing = await transferOfKey(tx, input.idempotencyKey);

				if (existing !== undefined) {
					const same =
						existing.fromAccountId === input.fromAccountId &&
						existing.toAccountId === input.toAccountId &&
						existing.date === input.date &&
						existing.amount === input.amount &&
						existing.sourceFee === input.sourceFee &&
						existing.destinationFee === input.destinationFee;

					if (!same) {
						throw new AppError(
							"TRANSFER_FORM_STALE",
							"This form was already sent with other values.",
						);
					}

					return { transfer: existing.transfer, created: false };
				}
			}

			const source = await transferAccount(tx, input.fromAccountId, "fromAccountId");
			const destination = await transferAccount(tx, input.toAccountId, "toAccountId");

			if (source.id === destination.id) {
				throw invalidField("toAccountId", "same_account");
			}

			// No exchange rate yet (AD-6): Sure's `Money::ConversionError` message.
			if (source.currency !== destination.currency) {
				throw invalidField("toAccountId", "exchange_rate_unavailable");
			}

			// A typo such as 2062 would write a balance row for every day up to it.
			if (isTooFarAhead(input.date, today(deps.timeZone))) {
				throw invalidField("date", "date_too_late");
			}

			if (input.tagIds.length > 0 && !(await tagsExist(tx, input.tagIds))) {
				throw invalidField("tagIds");
			}

			const now = Date.now();
			const prefix = classificationOf(destination.type) === "liability" ? "Paiement" : "Virement";
			const outflowLabel = `${prefix} vers ${destination.name}`;
			const inflowLabel = `${prefix} depuis ${source.name}`;
			const transfer: Transfer = {
				id: crypto.randomUUID(),
				outflowTransactionId: crypto.randomUUID(),
				inflowTransactionId: crypto.randomUUID(),
				kind: transferKindOf(destination.type, source.type),
				status: "confirmed",
				idempotencyKey: input.idempotencyKey ?? null,
				notes: null,
				createdAt: now,
			};
			// Sure's `user_modified: true` on both legs; its fees carry none.
			const legLocks = lockedBy(
				options.origin,
				{},
				input.tagIds.length > 0 ? ["date", "amount", "label", "tags"] : ["date", "amount", "label"],
				now,
			);
			const legs = [
				{
					id: transfer.outflowTransactionId,
					accountId: source.id,
					amount: 0 - input.amount,
					label: outflowLabel,
				},
				{
					id: transfer.inflowTransactionId,
					accountId: destination.id,
					amount: input.amount,
					label: inflowLabel,
				},
			];
			const feeCategoryId =
				input.sourceFee > 0 || input.destinationFee > 0
					? await categoryIdFor(tx, FEES_CATEGORY, now)
					: null;
			const fees = [
				{
					accountId: source.id,
					amount: input.sourceFee,
					label: `Frais de virement — ${outflowLabel}`,
				},
				{
					accountId: destination.id,
					amount: input.destinationFee,
					label: `Frais de virement — ${inflowLabel}`,
				},
			]
				.filter((fee) => fee.amount > 0)
				.map((fee) => ({ ...fee, id: crypto.randomUUID(), amount: 0 - fee.amount }));

			await tx.insert(entries).values(
				[...legs, ...fees].map((row) => ({
					id: row.id,
					accountId: row.accountId,
					kind: "transaction" as const,
					date: input.date,
					amount: row.amount,
					currency: source.currency,
					createdAt: now,
					updatedAt: now,
				})),
			);
			await tx
				.insert(transactions)
				.values(legs.map((leg) => ({ entryId: leg.id, label: leg.label, lockedFields: legLocks })));
			await tx.insert(transfers).values(transfer);
			await categoriseContributions(tx, [transfer], categoryOriginOf(options.origin), now);
			if (input.tagIds.length > 0) {
				await tx
					.insert(taggings)
					.values(
						legs.flatMap((leg) => input.tagIds.map((tagId) => ({ transactionId: leg.id, tagId }))),
					);
			}

			if (fees.length > 0) {
				await tx.insert(transactions).values(
					fees.map((fee) => ({
						entryId: fee.id,
						label: fee.label,
						categoryId: feeCategoryId,
						categoryOrigin: categoryOriginOf(options.origin),
					})),
				);
				await tx
					.insert(transferFees)
					.values(fees.map((fee) => ({ transactionId: fee.id, transferId: transfer.id })));
			}

			await oneByOne([source, destination], async (account) =>
				recomputeBalances(
					tx,
					await accountWithOpeningDate(tx, account.id),
					input.date,
					deps.timeZone,
				),
			);

			// The fee lines are standard lines, weighed as any line typed by hand.
			await matchTransfers(tx, now);

			return { transfer, created: true };
		},
		{ behavior: "immediate" },
	);
}
