import type { IsoDate } from "../../domain/dates.ts";
import type { ExpectingSide, TransferSide } from "../../domain/transfer-matching.ts";
import type { ServiceDeps } from "../deps.ts";
import type { Origin, Transaction } from "./shared.ts";
import type { SQL, SQLWrapper } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

import { and, between, eq, isNotNull, isNull, lt, ne, not, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import type { AccountType } from "@archant/data/account-types";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { entries } from "@archant/data/schema/entries";
import { rejectedTransfers } from "@archant/data/schema/rejected-transfers";
import { transactions } from "@archant/data/schema/transactions";
import { transfers } from "@archant/data/schema/transfers";
import type { TransferStatus } from "@archant/data/transfer-kinds";
import type { Transfer } from "@archant/data/types";

import { daysBetween } from "../../domain/dates.ts";
import {
	HAND_TRANSFER_WINDOW_DAYS,
	TRANSFER_WINDOW_DAYS,
	greedyMatches,
	isTransferCandidate,
	narrowToExpected,
	transferKindOf,
} from "../../domain/transfer-matching.ts";
import { AppError } from "../../lib/errors.ts";
import {
	ROWS_PER_INSERT,
	inAnyTransfer,
	inSequence,
	inTransferSql,
	invalidField,
	isSplitChild,
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
 * The SQL of `isTransferCandidate`'s `excluded`, `accountActive` and
 * `splitChild`: neither an excluded row, a row of a deactivated account nor a
 * split line is ever a side, as Sure's `Family::AutoTransferMatchable`; a
 * split parent is excluded (AD-20).
 */
function matchableSide(
	entry: Record<"parentEntryId", SQLiteColumn>,
	transaction: Record<"excluded", SQLiteColumn>,
	account: Record<"active", SQLiteColumn>,
): SQL | undefined {
	return and(
		isNull(entry.parentEntryId),
		eq(transaction.excluded, false),
		eq(account.active, true),
	);
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
	splitChild: isSplitChild.mapWith(Boolean),
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
				splitChild: isNotNull(sourceEntry.parentEntryId).mapWith(Boolean),
				expectedAccountId: sourceTransaction.expectedTransferAccountId,
			},
			candidate: {
				...sideColumns,
				label: transactions.label,
				accountName: accounts.name,
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
				matchableSide(sourceEntry, sourceTransaction, sourceAccount),
				matchableSide(entries, transactions, accounts),
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

/** The side ranking reads of a pair: its id, its account and the account a rule expects. */
const expecting = (side: { id: string; accountId: string; expectedAccountId: string | null }) => ({
	id: side.id,
	accountId: side.accountId,
	expectedAccountId: side.expectedAccountId,
});

/**
 * Step 6 of `ingest`, and the end of `applyRulePlanToHistory`: proposes a
 * `pending` transfer for the pairs Sure's `auto_match_transfers!` would
 * make, over every unmatched transaction of the household, so a line left
 * free before is weighed again (AD-11). A rule's expected counterpart
 * account narrows each line's candidates first, from both sides, through
 * `narrowToExpected`; `greedyMatches` then takes the closest pairs. Every
 * candidate is read before the first transfer is written, so the result
 * depends neither on line order nor on which account synced first. No
 * balance, category, lock or tag moves.
 */
export async function matchTransfers(
	tx: Pick<Transaction, "select" | "insert">,
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
			}))
	);
}

/**
 * Links `entryId` and `counterpartId` as one `confirmed` transfer, the
 * negative side as the outflow, its kind from the inflow account's type: the
 * owner chose it, so there is nothing left to confirm. The candidate search
 * runs again inside the write, so a concurrent match cannot put a
 * transaction in two transfers. A pair the owner once rejected may be paired
 * by hand. No balance moves and no category, lock or tag changes: the two
 * rows stay what they were, only their direction changes. Throws `NOT_FOUND`
 * for an unknown `entryId`, `VALIDATION_ERROR` on `counterpartId` when it is
 * no candidate, unknown, more than 30 days away, already matched, excluded
 * or on a deactivated account included.
 */
export async function matchTransfer(
	deps: ServiceDeps,
	entryId: string,
	counterpartId: string,
	_options: { origin: Origin },
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

			const transfer = transferBetween(pair.source, pair.candidate, "confirmed", Date.now());

			await tx.insert(transfers).values(transfer);

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
			const [deleted] = await tx
				.delete(transfers)
				.where(eq(transfers.id, transferId))
				.returning(sidesColumns);

			if (deleted === undefined) {
				throw new AppError("NOT_FOUND", "No transfer has this id.");
			}

			return deleted;
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
			const [deleted] = await tx
				.delete(transfers)
				.where(eq(transfers.id, transferId))
				.returning(sidesColumns);

			if (deleted === undefined) {
				throw new AppError("NOT_FOUND", "No transfer has this id.");
			}

			await tx.insert(rejectedTransfers).values({
				id: crypto.randomUUID(),
				...deleted,
				createdAt: Date.now(),
			});

			return deleted;
		},
		{ behavior: "immediate" },
	);
}
